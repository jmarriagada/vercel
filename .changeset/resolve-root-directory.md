---
'vercel': patch
---

Add opt-in resolution of per-directory project links against the repository root (gated behind `VERCEL_RESOLVE_ROOT_DIRECTORY=1`).

A project linked in place (`apps/api/.vercel/project.json`) is anchored by the link's physical location. When `vc build` runs from that directory, it previously treated the linked subdirectory as the repository root and interpreted the project's `rootDirectory` setting as an offset from there. That broke common setups:

- A `rootDirectory` that restates the link's own location (e.g. `apps/api` for a link at `apps/api`) double-appended into `apps/api/apps/api`, failing with `ENOENT … /apps/api/apps/api/.next/package.json`.
- A null `rootDirectory` left the repository root mis-detected as the subdirectory, so dependencies hoisted above it were not traced (runtime `Cannot find module`).

With the flag enabled, a per-directory link is resolved like a repo-level link: the repository root is detected (workspace markers, then git) and the project is expressed as its path relative to that root. The link's physical location is authoritative — a redundant `rootDirectory` is absorbed silently, and a mismatched one is ignored with an advisory rather than applied — so these setups "just work" regardless of which directory the command is run from. Behavior is unchanged when the flag is not set.
