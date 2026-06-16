---
'@vercel/container': patch
---

Build container images with buildah using a working storage driver
(fuse-overlayfs when available, otherwise vfs) and report — without failing the
build — whether buildah came up on the intended native `overlay` driver backed
by the mounted XFS `/var/lib/containers` volume. The volume mount ships via the
deployed api-build-containers-loop service rather than the pinned build-container
image, so it is not yet applied on all cells; the storage report is therefore
observability-only by default. Set `VERCEL_VCR_STRICT_STORAGE=1` to fail the
build on a mismatch, or `VERCEL_VCR_DEFER_STORAGE_CONF=1` to defer to the image's
storage.conf (native overlay) once the volume is reliably mounted. Also pass
`buildah build --layers` for per-instruction layer caching.
