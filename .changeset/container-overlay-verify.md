---
'@vercel/container': patch
---

Require and verify the native `overlay` storage driver for buildah in the build
container instead of silently falling back to `vfs`. We now defer to the build
image's `/etc/containers/storage.conf` (native overlay with graphroot on the
mounted `/var/lib/containers` XFS volume) and assert via `buildah info` that the
effective driver is `overlay` on the expected volume, failing the build loudly
otherwise. Also pass `buildah build --layers` to enable per-instruction layer
caching. Set `VERCEL_VCR_ALLOW_VFS_FALLBACK=1` to downgrade the check to a
warning.
