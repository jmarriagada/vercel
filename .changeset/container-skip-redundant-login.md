---
'@vercel/container': patch
---

Skip the explicit registry login when the build container has already
provisioned credentials. The Vercel build container writes
`~/.config/containers/auth.json` (see vercel/api#76560) before the builder runs,
so buildah/podman authenticate automatically. Running `buildah login` on top of
that is redundant and risks overwriting the provisioned credentials. The builder
now detects an existing auth file (via `REGISTRY_AUTH_FILE` or the default
`$XDG_CONFIG_HOME/containers/auth.json`) and skips the login step, while local
`vercel build` (docker engine) still logs in explicitly. Set
`VERCEL_VCR_FORCE_LOGIN=1` to force an explicit login for debugging.
