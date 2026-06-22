---
'@vercel/container': patch
---

Cache buildah's image layer store between builds via `prepareCache`. The store
(`/vercel/.containers/storage`) is globbed and restored, so a warm store lets
buildah reuse unchanged layers (`buildah build --layers`) instead of rebuilding
them. Build logs now report layer-cache effectiveness (`layer cache: X/N steps
reused, M rebuilt`) and how much of the store was cached. Disable with
`VERCEL_VCR_DISABLE_LAYER_CACHE=1`. Also adds `exec:` debug logging of the exact
buildah/docker commands and push timing.
