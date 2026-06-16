---
'@vercel/container': patch
---

Add a debug-only post-build report of buildah's effective image store
(graphRoot, runRoot, driver, backing filesystem) via `buildah info`. This
confirms the build is using the mounted cell storage volume
(`/var/lib/containers`). Only runs when builder debug is enabled.
