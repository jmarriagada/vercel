import execa from 'execa';
import which from 'which';
import fs from 'fs';
import { join, sep } from 'path';
import { debug } from '@vercel/build-utils';
import type { DistributionIndex } from '@vercel/python-analysis';

/**
 * Match native shared libraries: `foo.so`, `foo.so.1`, `foo.so.1.2.3`.
 * These are ELF objects shipped inside binary wheels (numpy, pydantic-core,
 * cryptography, etc.) and usually retain debug symbols that are dead weight at
 * runtime.
 */
export function isNativeLibrary(filePath: string): boolean {
  const name = filePath.split(sep).pop() ?? '';
  return /\.so(\.\d+)*$/.test(name);
}

/** Whether the user has explicitly disabled native library stripping. */
function isStripDisabled(): boolean {
  const value = process.env.VERCEL_PYTHON_STRIP_BINARIES;
  if (value === undefined || value === '') return false;
  const lower = value.toLowerCase();
  return lower === '0' || lower === 'false';
}

type CanonicalArch = 'x86_64' | 'aarch64';

/** Canonical architecture of the build host. */
function hostArch(): CanonicalArch | undefined {
  switch (process.arch) {
    case 'x64':
      return 'x86_64';
    case 'arm64':
      return 'aarch64';
    default:
      return undefined;
  }
}

/** Normalize the various architecture spellings to a canonical value. */
function normalizeArch(arch: string | undefined): CanonicalArch | undefined {
  if (!arch) return undefined;
  if (arch === 'x86_64' || arch === 'x64') return 'x86_64';
  if (arch === 'aarch64' || arch === 'arm64') return 'aarch64';
  return undefined;
}

async function findTool(name: string): Promise<string | null> {
  try {
    return await which(name);
  } catch {
    return null;
  }
}

interface StripTool {
  bin: string;
  args: string[];
}

/**
 * Resolve a strip binary capable of processing objects for the target
 * architecture.
 *
 * `llvm-strip` is architecture-agnostic, so it is preferred when present (it
 * also handles cross-architecture builds).  Otherwise we fall back to binutils
 * `strip`, which can only process the host architecture's ELF objects — so it
 * is only used when the build host and the deploy target share an architecture.
 *
 * Uses `--strip-unneeded` (not `--strip-all`) so dynamic symbols required to
 * load the shared object are preserved.
 */
async function resolveStripTool(
  targetArch: CanonicalArch | undefined
): Promise<StripTool | null> {
  const llvm = await findTool('llvm-strip');
  if (llvm) {
    return { bin: llvm, args: ['--strip-unneeded'] };
  }

  const strip = await findTool('strip');
  if (!strip) {
    return null;
  }

  const host = hostArch();
  // An undefined target means we are building on the deploy image itself, so
  // the target architecture is the host architecture.
  const effectiveTarget = targetArch ?? host;
  if (host && effectiveTarget && host === effectiveTarget) {
    return { bin: strip, args: ['--strip-unneeded'] };
  }

  return null;
}

/** Run an async function over `items` with a bounded level of concurrency. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) break;
        results[index] = await fn(items[index]);
      }
    })()
  );
  await Promise.all(workers);
  return results;
}

interface StripOptions {
  sitePackageDirs: string[];
  distributions: Map<string, DistributionIndex>;
  /** Deploy target architecture (`x86_64`, `aarch64`, `arm64`, or undefined). */
  targetArch: string | undefined;
  /** Skip stripping in `vercel dev`. */
  isDev?: boolean;
}

interface StripResult {
  /** Number of `.so` files successfully stripped. */
  count: number;
  /** Total bytes removed across all stripped libraries. */
  savedBytes: number;
}

/**
 * Strip debug symbols from the native shared libraries of installed
 * dependencies, in place, to reduce the uncompressed bundle size.
 *
 * Best-effort: any file that cannot be stripped (incompatible object, missing
 * tool, error) is left untouched.  Callers must re-`stat` native libraries
 * afterwards since their RECORD sizes become stale.
 */
export async function stripNativeLibraries({
  sitePackageDirs,
  distributions,
  targetArch,
  isDev,
}: StripOptions): Promise<StripResult> {
  const empty: StripResult = { count: 0, savedBytes: 0 };

  if (isDev) {
    return empty;
  }
  if (isStripDisabled()) {
    debug('native library stripping disabled via VERCEL_PYTHON_STRIP_BINARIES');
    return empty;
  }

  const tool = await resolveStripTool(normalizeArch(targetArch));
  if (!tool) {
    debug(
      'skipping native library stripping: no compatible strip tool for the target architecture'
    );
    return empty;
  }

  // Collect the unique set of native library paths across all distributions.
  const candidates = new Set<string>();
  for (const dir of sitePackageDirs) {
    const dirDistributions = distributions.get(dir);
    if (!dirDistributions) continue;
    for (const [, dist] of dirDistributions) {
      for (const { path: rawPath } of dist.files) {
        const relPath = rawPath.replaceAll('/', sep);
        if (isNativeLibrary(relPath)) {
          candidates.add(join(dir, relPath));
        }
      }
    }
  }

  if (candidates.size === 0) {
    return empty;
  }

  const paths = [...candidates];
  const perFile = await mapWithConcurrency(paths, 16, async fsPath => {
    let before: number;
    try {
      before = (await fs.promises.stat(fsPath)).size;
    } catch {
      return 0; // missing on disk
    }
    try {
      await execa(tool.bin, [...tool.args, fsPath]);
    } catch (err) {
      debug(`could not strip "${fsPath}": ${JSON.stringify(err)}`);
      return 0;
    }
    try {
      const after = (await fs.promises.stat(fsPath)).size;
      return Math.max(0, before - after);
    } catch {
      return 0;
    }
  });

  let savedBytes = 0;
  let count = 0;
  for (const saved of perFile) {
    if (saved > 0) {
      savedBytes += saved;
      count += 1;
    }
  }

  if (count > 0) {
    const savedMB = (savedBytes / (1024 * 1024)).toFixed(2);
    debug(`Stripped ${count} native libraries, saving ${savedMB} MB`);
  }

  return { count, savedBytes };
}
