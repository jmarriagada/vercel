---
'@vercel/python': patch
---

Scope `compileall` bytecode precompilation to Hive deployments. It now runs only when `VERCEL_PYTHON_ON_HIVE` is set and is gated behind `VERCEL_PYTHON_COMPILEALL` as an explicit opt-in flag (default off). The dev and custom-command guards are unchanged.
