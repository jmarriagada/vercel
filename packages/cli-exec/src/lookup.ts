import { access, constants, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  LocalBinSearchDiagnostics,
  ResolutionDiagnostics,
  SkippedNodeModules,
} from './diagnostics';
import { getEnvPath, prependPathEntries, splitPath } from './envpath';
import { getErrorMessage } from './errutils';
import {
  getCanonicalPath,
  getCommandBase,
  getDirectoriesBetween,
  isNodeScript,
  isSubpath,
} from './fsutils';
import {
  getSkippedNodeModulesReason,
  getUnsafePackageBinReason,
  getUnsafePackageDirectoryReason,
  getUnsafePackageFileReason,
} from './safety';
import type { FindVercelCliOptions, VercelCliInvocation } from './types';

/**
 * Resolved executable path and source before conversion to invocation args.
 */
interface ResolvedCommand {
  realPath: string;
  source: VercelCliInvocation['source'];
}

/**
 * Internal result of CLI resolution, including successful and missing lookups.
 */
type VercelCliResolution = ResolvedVercelCliInvocation | MissingVercelCli;

/**
 * Successful CLI lookup result with diagnostics preserved for callers upstream.
 */
interface ResolvedVercelCliInvocation extends VercelCliInvocation {
  found: true;
  diagnostics: ResolutionDiagnostics;
}

/**
 * Missing CLI lookup result with diagnostics explaining skipped candidates.
 */
interface MissingVercelCli {
  found: false;
  diagnostics: ResolutionDiagnostics;
}

/**
 * Trusted local bin directories and the diagnostics collected while finding them.
 */
interface LocalBinSearch {
  directories: string[];
  diagnostics: LocalBinSearchDiagnostics;
}

/**
 * Ancestor directory walk result and the boundary that stopped traversal.
 */
interface AncestorDirectorySearch {
  directories: string[];
  stoppedAt: string;
  stopReason: LocalBinSearchDiagnostics['stopReason'];
  markerPath?: string;
}

/**
 * Project root marker used to stop local bin traversal.
 */
interface ProjectRootMarker {
  path: string;
}

/**
 * Result of validating the `vercel` package bin declaration.
 */
type LocalVercelPackageBinResult = { binPath: string } | { reason: string };

/**
 * Verified local package metadata needed to resolve the declared bin.
 */
interface LocalVercelPackage {
  realNodeModulesDirectory: string;
  realPackageDirectory: string;
  packageJson: { name?: unknown; bin?: unknown };
}

/**
 * Classification for a PATH entry that may be a local bin candidate.
 */
type LocalBinCandidate = { directory: string } | { reason: string } | null;

// Cache misses too so repeated calls do not keep rescanning PATH in long-lived
// processes. Callers can clear the cache to force re-resolution after installs.
const cliInvocationCache = new Map<string, Promise<VercelCliResolution>>();

/**
 * Resolves the Vercel CLI from the nearest `node_modules/.bin` directories
 * first, then falls back to the provided `PATH`.
 *
 * Returns `null` when no usable CLI executable can be found.
 */
export async function findVercelCli(
  options: FindVercelCliOptions = {}
): Promise<VercelCliInvocation | null> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const pathValue = options.path ?? getEnvPath(process.env);
  const resolution = await resolveCachedCliInvocation(cwd, pathValue);

  return resolution.found ? toVercelCliInvocation(resolution) : null;
}

/**
 * Resolves and caches the full CLI resolution, including miss diagnostics.
 */
export function resolveCachedCliInvocation(
  cwd: string,
  pathValue: string
): Promise<
  | ResolvedVercelCliInvocation
  | {
      found: false;
      diagnostics: ResolutionDiagnostics;
    }
> {
  const cacheKey = getCliInvocationCacheKey(cwd, pathValue);

  if (cliInvocationCache.has(cacheKey)) {
    return cliInvocationCache.get(cacheKey)!;
  }

  const resolution = resolveCliInvocation(cwd, pathValue).catch(error => {
    cliInvocationCache.delete(cacheKey);
    throw error;
  });

  cliInvocationCache.set(cacheKey, resolution);
  return resolution;
}

/**
 * Removes internal resolution diagnostics from a successful CLI lookup result.
 */
export function toVercelCliInvocation(
  resolution: ResolvedVercelCliInvocation
): VercelCliInvocation {
  return {
    command: resolution.command,
    commandArgs: resolution.commandArgs,
    source: resolution.source,
  };
}

/**
 * Clears cached positive and negative CLI resolutions.
 *
 * Call this after installing or removing the CLI in a long-lived process that
 * needs to re-resolve the executable from disk.
 */
export function clearVercelCliLookupCache() {
  cliInvocationCache.clear();
}

/**
 * Clears one cached CLI resolution for retry after a stale executable failed.
 */
export function clearCachedCliInvocation(cwd: string, pathValue: string) {
  cliInvocationCache.delete(getCliInvocationCacheKey(cwd, pathValue));
}

/**
 * Resolves the CLI invocation from local bins first, then the provided PATH.
 */
async function resolveCliInvocation(
  cwd: string,
  pathValue: string
): Promise<VercelCliResolution> {
  const localBinSearch = await getLocalBinSearch(cwd);
  const diagnostics: ResolutionDiagnostics = {
    localBinSearch: localBinSearch.diagnostics,
    skippedLocalBins: [],
  };
  const resolvedPath = prependPathEntries(
    pathValue,
    localBinSearch.directories
  );

  for (const command of getVercelCommandNames()) {
    const resolvedCommand = await findCommandInPath(
      command,
      resolvedPath,
      cwd,
      localBinSearch,
      diagnostics
    );
    if (!resolvedCommand) {
      continue;
    }

    if (isNodeScript(resolvedCommand.realPath)) {
      return {
        found: true,
        command: process.execPath,
        commandArgs: [resolvedCommand.realPath],
        source: resolvedCommand.source,
        diagnostics,
      };
    }

    return {
      found: true,
      command: resolvedCommand.realPath,
      commandArgs: [],
      source: resolvedCommand.source,
      diagnostics,
    };
  }

  return { found: false, diagnostics };
}

/**
 * Resolves the first usable command from PATH, validating local bins specially.
 */
async function findCommandInPath(
  command: string,
  pathValue: string,
  cwd: string,
  localBinSearch: LocalBinSearch,
  diagnostics: ResolutionDiagnostics
): Promise<ResolvedCommand | null> {
  for (const directory of splitPath(pathValue)) {
    const candidateDirectory = path.isAbsolute(directory)
      ? directory
      : path.resolve(cwd, directory);
    const candidate = path.join(candidateDirectory, command);
    try {
      await access(
        candidate,
        process.platform === 'win32'
          ? constants.F_OK
          : constants.F_OK | constants.X_OK
      );

      if (!(await stat(candidate)).isFile()) {
        continue;
      }

      let realPath = await realpath(candidate);
      let source: VercelCliInvocation['source'] = 'path';
      const localBinCandidate = await getLocalBinCandidate(
        candidate,
        localBinSearch.directories
      );

      if (localBinCandidate) {
        if ('reason' in localBinCandidate) {
          diagnostics.skippedLocalBins.push({
            candidate,
            reason: localBinCandidate.reason,
          });
          continue;
        }

        const localPackageBinResult = await getLocalVercelPackageBin(
          command,
          localBinCandidate.directory
        );

        if ('reason' in localPackageBinResult) {
          diagnostics.skippedLocalBins.push({
            candidate,
            reason: localPackageBinResult.reason,
          });
          continue;
        }

        realPath = localPackageBinResult.binPath;
        source = 'local-bin';
      }

      return { realPath, source };
    } catch {}
  }

  return null;
}

/**
 * Returns platform-specific executable names for the canonical Vercel command.
 */
function getVercelCommandNames(): string[] {
  // Intentionally resolve only the canonical `vercel` binary. `vc` is a
  // convenience alias for interactive use, but callers should not depend on it
  // being present in every installation layout.
  const commandBases = ['vercel'];

  if (process.platform !== 'win32') {
    return commandBases;
  }

  const extensions = ['.cmd', '.exe', ''];
  return commandBases.flatMap(command =>
    extensions.map(extension => `${command}${extension}`)
  );
}

/**
 * Builds local bin candidates and diagnostics for skipped unsafe directories.
 */
export async function getLocalBinSearch(cwd: string): Promise<LocalBinSearch> {
  const searchRoot = await getCanonicalPath(path.resolve(cwd));
  const ancestorSearch = await getAncestorDirectorySearch(searchRoot);
  const skippedNodeModules: SkippedNodeModules[] = [];
  const directories: string[] = [];

  for (const directory of ancestorSearch.directories) {
    const nodeModulesDirectory = path.join(directory, 'node_modules');
    const parentDirectories =
      ancestorSearch.stopReason === 'project-root-marker'
        ? getDirectoriesBetween(ancestorSearch.stoppedAt, directory)
        : getDirectoriesBetween(directory, searchRoot);
    const skippedReason = await getSkippedNodeModulesReason(
      nodeModulesDirectory,
      parentDirectories
    );

    if (skippedReason) {
      skippedNodeModules.push({
        directory: nodeModulesDirectory,
        reason: skippedReason,
      });
      continue;
    }

    directories.push(path.join(nodeModulesDirectory, '.bin'));
  }

  return {
    directories,
    diagnostics: {
      searchRoot,
      stoppedAt: ancestorSearch.stoppedAt,
      stopReason: ancestorSearch.stopReason,
      markerPath: ancestorSearch.markerPath,
      skippedNodeModules,
    },
  };
}

/**
 * Walks ancestor directories until a project marker or filesystem root is hit.
 */
async function getAncestorDirectorySearch(
  cwd: string
): Promise<AncestorDirectorySearch> {
  const directories = [];
  let current = path.resolve(cwd);

  while (true) {
    directories.push(current);

    const marker = await getProjectRootMarker(current);

    if (marker) {
      return {
        directories,
        stoppedAt: current,
        stopReason: 'project-root-marker',
        markerPath: marker.path,
      };
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return {
        directories,
        stoppedAt: current,
        stopReason: 'filesystem-root',
      };
    }
    current = parent;
  }
}

/**
 * Returns the project root marker used to stop local bin traversal.
 */
async function getProjectRootMarker(
  directory: string
): Promise<ProjectRootMarker | null> {
  const gitPath = path.join(directory, '.git');

  try {
    await stat(gitPath);
    return { path: gitPath };
  } catch {}

  return null;
}

/**
 * Returns the trusted local bin directory that contains `filePath`, if any.
 */
async function getLocalBinDirectory(
  filePath: string,
  localBinDirectories: string[]
): Promise<string | null> {
  const resolvedFilePath = path.resolve(filePath);
  let canonicalFilePath = resolvedFilePath;

  try {
    canonicalFilePath = path.join(
      await realpath(path.dirname(resolvedFilePath)),
      path.basename(resolvedFilePath)
    );
  } catch {}

  for (let localBinDirectory of localBinDirectories) {
    try {
      localBinDirectory = await realpath(localBinDirectory);
    } catch {}

    if (canonicalFilePath.startsWith(`${localBinDirectory}${path.sep}`)) {
      return localBinDirectory;
    }
  }

  return null;
}

/**
 * Detects whether `filePath` is located inside a `node_modules/.bin` directory.
 */
async function getNodeModulesBinDirectory(
  filePath: string
): Promise<string | null> {
  const candidateDirectory = path.resolve(path.dirname(filePath));
  const directories = [candidateDirectory];

  try {
    const canonicalDirectory = await realpath(candidateDirectory);

    if (!directories.includes(canonicalDirectory)) {
      directories.push(canonicalDirectory);
    }
  } catch {}

  for (const directory of directories) {
    if (
      path.basename(directory) === '.bin' &&
      path.basename(path.dirname(directory)) === 'node_modules'
    ) {
      return directory;
    }
  }

  return null;
}

/**
 * Classifies a PATH candidate as trusted local bin, rejected local bin, or PATH.
 */
async function getLocalBinCandidate(
  filePath: string,
  localBinDirectories: string[]
): Promise<LocalBinCandidate> {
  const localBinDirectory = await getLocalBinDirectory(
    filePath,
    localBinDirectories
  );

  if (localBinDirectory) {
    return { directory: localBinDirectory };
  }

  const nodeModulesBinDirectory = await getNodeModulesBinDirectory(filePath);

  if (!nodeModulesBinDirectory) {
    return null;
  }

  const nodeModulesDirectory = path.dirname(nodeModulesBinDirectory);
  const skippedReason = await getSkippedNodeModulesReason(nodeModulesDirectory);

  if (skippedReason) {
    return { reason: `local node_modules is ${skippedReason}` };
  }

  return { reason: 'local bin is outside project lookup boundary' };
}

/**
 * Validates that a local bin resolves to the installed `vercel` package bin.
 */
async function getLocalVercelPackageBin(
  command: string,
  localBinDirectory: string
): Promise<LocalVercelPackageBinResult> {
  const commandBase = getCommandBase(command);
  const nodeModulesDirectory = path.dirname(localBinDirectory);

  if (
    commandBase !== 'vercel' ||
    path.basename(nodeModulesDirectory) !== 'node_modules'
  ) {
    return { reason: 'not a local vercel bin' };
  }

  try {
    const localPackage = await getLocalVercelPackage(nodeModulesDirectory);

    if ('reason' in localPackage) {
      return localPackage;
    }

    const packageJsonResult = await readLocalVercelPackageJson(
      localPackage.realPackageDirectory
    );

    if ('reason' in packageJsonResult) {
      return packageJsonResult;
    }

    localPackage.packageJson = packageJsonResult.packageJson;

    return await getDeclaredLocalVercelPackageBin(localPackage, commandBase);
  } catch (error) {
    return {
      reason: `could not validate local vercel package: ${getErrorMessage(error)}`,
    };
  }
}

/**
 * Resolves and validates the local `vercel` package directory.
 */
async function getLocalVercelPackage(
  nodeModulesDirectory: string
): Promise<LocalVercelPackage | { reason: string }> {
  const packageDirectory = path.join(nodeModulesDirectory, 'vercel');
  const realNodeModulesDirectory = await realpath(nodeModulesDirectory);
  const realPackageDirectory = await realpath(packageDirectory);

  if (!isSubpath(realNodeModulesDirectory, realPackageDirectory)) {
    return {
      reason: 'local vercel package resolves outside local node_modules',
    };
  }

  const unsafePackageDirectoryReason = await getUnsafePackageDirectoryReason(
    realNodeModulesDirectory,
    realPackageDirectory
  );

  if (unsafePackageDirectoryReason) {
    return {
      reason: `local vercel package is unsafe: ${unsafePackageDirectoryReason}`,
    };
  }

  return {
    realNodeModulesDirectory,
    realPackageDirectory,
    packageJson: {},
  };
}

/**
 * Reads and validates the local `vercel` package metadata file.
 */
async function readLocalVercelPackageJson(
  realPackageDirectory: string
): Promise<
  { packageJson: { name?: unknown; bin?: unknown } } | { reason: string }
> {
  const packageJsonPath = path.join(realPackageDirectory, 'package.json');
  const realPackageJsonPath = await realpath(packageJsonPath);

  if (!isSubpath(realPackageDirectory, realPackageJsonPath)) {
    return { reason: 'local vercel package.json resolves outside package' };
  }

  const unsafePackageJsonReason = await getUnsafePackageFileReason(
    realPackageDirectory,
    realPackageJsonPath
  );

  if (unsafePackageJsonReason) {
    return {
      reason: `local vercel package.json is unsafe: ${unsafePackageJsonReason}`,
    };
  }

  const packageJson = JSON.parse(
    await readFile(realPackageJsonPath, 'utf8')
  ) as {
    name?: unknown;
    bin?: unknown;
  };

  if (packageJson.name !== 'vercel') {
    return {
      reason: 'local vercel package.json does not have name "vercel"',
    };
  }

  return { packageJson };
}

/**
 * Resolves and validates the bin declared by the local `vercel` package.
 */
async function getDeclaredLocalVercelPackageBin(
  localPackage: LocalVercelPackage,
  commandBase: string
): Promise<LocalVercelPackageBinResult> {
  const { packageJson, realNodeModulesDirectory, realPackageDirectory } =
    localPackage;

  const binTarget = getPackageBinTarget(packageJson, commandBase);

  if (!binTarget) {
    return { reason: 'local vercel package does not declare bin.vercel' };
  }

  const declaredBinPath = path.resolve(realPackageDirectory, binTarget);
  const realDeclaredBinPath = await realpath(declaredBinPath);

  if (!isSubpath(realPackageDirectory, realDeclaredBinPath)) {
    return { reason: 'local vercel package bin resolves outside package' };
  }

  const unsafePackageBinReason = await getUnsafePackageBinReason(
    realNodeModulesDirectory,
    realPackageDirectory,
    realDeclaredBinPath
  );

  if (unsafePackageBinReason) {
    return {
      reason: `local vercel package bin is unsafe: ${unsafePackageBinReason}`,
    };
  }

  if (process.platform !== 'win32' && !isNodeScript(realDeclaredBinPath)) {
    await access(realDeclaredBinPath, constants.F_OK | constants.X_OK);
  }

  return { binPath: realDeclaredBinPath };
}

/**
 * Reads the declared bin target for the requested command from package data.
 */
function getPackageBinTarget(
  packageJson: { bin?: unknown },
  command: string
): string | null {
  const bin = packageJson.bin;

  if (typeof bin === 'string') {
    return command === 'vercel' ? bin : null;
  }

  if (bin && typeof bin === 'object') {
    const target = (bin as Record<string, unknown>)[command];

    if (typeof target === 'string') {
      return target;
    }
  }

  return null;
}

/**
 * Builds the cache key for a lookup rooted at `cwd` and a PATH value.
 */
function getCliInvocationCacheKey(cwd: string, pathValue: string): string {
  return `${cwd}\0${pathValue}`;
}
