---
'@vercel/container': patch
---

Use the existing `VERCEL_OIDC_TOKEN` to authenticate to the Vercel Container
Registry instead of always minting a new token. The token from `vercel pull`
(or the platform) is already a valid project OIDC token; minting a fresh one
requires a user/CLI auth token (`VERCEL_TOKEN`) since an OIDC token cannot mint
another OIDC token. Minting is now best-effort: it only runs when `VERCEL_TOKEN`
is present and falls back to the existing token if it fails, so `vercel build`
no longer fails with `403 invalidToken` during local container builds.
