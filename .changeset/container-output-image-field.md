---
'@vercel/container': patch
---

Emit the OCI image reference as `image` on the container build output instead of
`handler`. The output no longer sets `handler` for `runtime: 'container'`
functions.
