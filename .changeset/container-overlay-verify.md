---
'@vercel/container': patch
---

Align buildah storage with the build image's `storage.conf`: the graphroot now
lives under `/vercel/.containers/storage` (the always-mounted XFS cell volume,
so the native `overlay` driver doesn't nest on the cell rootfs). In the build
container we defer to `storage.conf` (native overlay) instead of forcing a
`--storage-driver`. A post-init `buildah info` check reports whether we actually
came up on overlay+XFS — observability-only by default (logs, doesn't fail the
build). Set `VERCEL_VCR_STRICT_STORAGE=1` to fail on a mismatch, or
`VERCEL_VCR_DOCKER_STORAGE_DRIVER=vfs` to force a working driver if overlay
can't initialize. Also pass `buildah build --layers` for per-instruction layer
caching.
