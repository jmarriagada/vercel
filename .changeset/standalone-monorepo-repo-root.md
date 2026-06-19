---
'vercel': patch
---

Add an opt-in, consistent fix for `vc build --standalone` from a monorepo subdirectory (gated behind `VERCEL_DETECT_REPO_ROOT=1`).

When a standalone (prebuilt) build runs from an app directory whose dependencies are hoisted to the monorepo root (e.g. pnpm's `<root>/node_modules/.pnpm/...`), tracing relative to the app directory produces function file keys that escape the function root (`../../node_modules/...`). That breaks zipping (`invalid relative path`) and, even when the bytes are packaged, leaves dependencies unreachable at runtime (`Cannot find module 'hono'` / `Cannot find module 'next/dist/...'`).

With the flag enabled, the build resolves the true monorepo root (via workspace markers, falling back to git, then cwd) and traces relative to it, so:

- traced dependency keys are anchored inside the function (no escaping paths),
- dependency files are written directly into the function with no `filePathMap`/`shared` indirection, and
- package-manager symlinks are preserved (with their targets re-anchored) so bare imports resolve at runtime.

This behaves identically across frameworks (verified for Hono via `@vercel/node` and Next.js via `@vercel/next`). The previous behavior is unchanged when the flag is not set.
