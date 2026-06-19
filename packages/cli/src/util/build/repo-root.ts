import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { getGitRootDirectory } from '../git-helpers';

/**
 * Resolves the root of the repository/monorepo that contains `cwd`.
 *
 * Standalone (prebuilt) builds run from an app directory but their
 * dependencies are frequently hoisted to the monorepo root above it (e.g.
 * pnpm's `<root>/node_modules/.pnpm/...`). To produce a self-contained
 * function, the build must trace files relative to that true root rather than
 * the app directory — otherwise traced file keys climb out of the function
 * (`../../node_modules/...`) and break both zipping and runtime resolution.
 *
 * Detection walks up from `cwd` and prefers, in order:
 *
 *  1. A workspace marker that defines a monorepo (pnpm-workspace.yaml, a
 *     `package.json` with a `workspaces` field, lerna.json, or rush.json).
 *     This is the most reliable signal and, crucially, does not depend on a
 *     `.git` directory being present — many CI / prebuilt flows build from a
 *     shallow copy or an extracted artifact with no git metadata.
 *  2. The Git repository root (`git rev-parse --show-toplevel`), as a fallback
 *     when no workspace marker is found but the project is in a git checkout.
 *  3. `cwd` itself, when nothing else can be determined.
 *
 * The returned path is always an ancestor of (or equal to) `cwd`.
 */
export function resolveRepoRoot({ cwd }: { cwd: string }): string {
  const workspaceRoot = findWorkspaceRoot(cwd);
  if (workspaceRoot) {
    return workspaceRoot;
  }

  const gitRoot = getGitRootDirectory({ cwd });
  if (gitRoot) {
    return gitRoot;
  }

  return cwd;
}

/**
 * Walks up the directory tree from `startDir` looking for the highest-level
 * workspace marker. Returns the workspace root, or `null` when none is found.
 *
 * We return the *highest* matching ancestor so that nested setups (an app
 * inside a package inside a monorepo) resolve to the outermost workspace,
 * which is where dependencies are ultimately hoisted.
 */
export function findWorkspaceRoot(startDir: string): string | null {
  const { root } = parse(startDir);
  let dir = startDir;
  let highestMatch: string | null = null;

  // Bound the traversal to avoid pathological loops; a monorepo is never
  // hundreds of directories deep.
  for (let i = 0; i < 64; i++) {
    if (isWorkspaceRoot(dir)) {
      highestMatch = dir;
    }
    if (dir === root) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return highestMatch;
}

/**
 * Returns true when `dir` looks like the root of a workspace/monorepo.
 */
function isWorkspaceRoot(dir: string): boolean {
  if (
    existsSync(join(dir, 'pnpm-workspace.yaml')) ||
    existsSync(join(dir, 'lerna.json')) ||
    existsSync(join(dir, 'rush.json'))
  ) {
    return true;
  }

  // npm / yarn / bun workspaces are declared via `workspaces` in package.json.
  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const { workspaces } = pkg;
      if (
        (Array.isArray(workspaces) && workspaces.length > 0) ||
        (workspaces &&
          typeof workspaces === 'object' &&
          Array.isArray(workspaces.packages) &&
          workspaces.packages.length > 0)
      ) {
        return true;
      }
    } catch {
      // Malformed package.json — ignore and keep walking.
    }
  }

  return false;
}
