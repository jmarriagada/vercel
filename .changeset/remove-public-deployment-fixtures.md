---
'vercel': patch
'@vercel/client': patch
'@vercel/config': patch
---

Remove deprecated `public` from deployment test fixtures and helpers, and stop the CLI from sending the removed `public` field on deploy (including the `--public` flag).
