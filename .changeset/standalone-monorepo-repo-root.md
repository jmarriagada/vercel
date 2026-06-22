---
'vercel': patch
---

Add opt-in repository-root detection for `vc build` run from a monorepo subdirectory (gated behind `VERCEL_DETECT_REPO_ROOT=1`).

When `vc build` is invoked from a subdirectory (e.g. `--cwd apps/docs`), `repoRootPath` defaults to that directory instead of the repository root. Any build whose dependencies live above the subdirectory then breaks, in several ways that share this one root cause:

- **Next.js (Turbopack)** errors with `Next.js inferred your workspace root, but it may not be correct ... couldn't find the Next.js package (next/package.json)`, because `outputFileTracingRoot` / `turbopack.root` are set to the app directory.
- **Next.js (Webpack) and other builders** omit hoisted dependencies (e.g. `sharp`, even `next` itself) from `.nft.json` traces, causing `Cannot find module` errors at runtime.
- **`--standalone`** produces function file keys that escape the function root (`../../node_modules/...`), breaking zipping (`invalid relative path`) and leaving dependencies unreachable at runtime (`Cannot find module 'hono'` / `next/dist/...`).

With the flag enabled, the build resolves the true repository root (via workspace markers — `pnpm-workspace.yaml`, `package.json` `workspaces`, `lerna.json`, `rush.json` — falling back to the git root, then `cwd`) and uses it as `repoRootPath` so builders trace from the correct location. For `--standalone`, dependency files are additionally written directly into the function and package-manager symlinks are preserved (targets re-anchored) so bare imports resolve at runtime, with no `filePathMap`/`shared` indirection.

This is framework-agnostic (verified for Hono via `@vercel/node` and Next.js via `@vercel/next`, standalone and non-standalone). Behavior is unchanged when the flag is not set.
