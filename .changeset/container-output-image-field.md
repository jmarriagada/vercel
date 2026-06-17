---
'@vercel/container': patch
'@vercel/build-utils': patch
'vercel': patch
---

Use `image` instead of `handler` for the OCI image reference on container build
outputs. `@vercel/container` now emits `image`, `ContainerImage` /
`ContainerImageConfig` expose `image`, and the CLI writes `image` into the
container function's `.vc-config.json`. No `handler` field is emitted for
`runtime: 'container'`.
