---
'@vercel/container': patch
'@vercel/build-utils': patch
'vercel': patch
---

Carry the OCI image reference in `handler` (not `image`) on container build
output, matching the `Lambda` build-output contract. Container functions are
`type: 'Lambda'` with `runtime: 'container'`, and the build container's
deserialize/finalize path (and vercel/api#76729) read `handler`; emitting
`image` caused `"handler" is not a string` during build-output deserialization.
api-builds surfaces `handler` as `config.image` downstream.
