---
'@vercel/python': patch
---

Record the `python.bundle.totalSizeBytes` build span tag before the bundle size-limit checks, so oversized functions that exceed the limit (and fail the build) still report their size instead of being omitted from telemetry.
