---
'vercel': patch
---

Fix `vc build --standalone` from a monorepo subdirectory so dependencies are reachable at runtime.

Two changes work together:

- Use the Git repository root as the build `repoRootPath` so standalone builds from monorepo subdirectories trace hoisted dependencies correctly.
- Preserve the package-manager symlinks that link a dependency into an app's `node_modules` (e.g. pnpm's `apps/api/node_modules/hono` -> `../../node_modules/.pnpm/.../hono`) instead of dropping them, re-anchoring their targets so they resolve inside the function. Previously these "external" symlinks were skipped, so even though the traced dependency bytes were packaged, Node could not resolve bare imports at runtime, failing with `Cannot find module 'hono'` / `Cannot find module 'next/dist/...'`.
