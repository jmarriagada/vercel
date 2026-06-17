---
'@vercel/python': patch
---

Reduce Python function bundle size: strip debug symbols from native shared libraries (`.so`) and prune additional never-at-runtime files (`RECORD`, `top_level.txt`, `REQUESTED`, C/Cython sources, and C/C++ headers). Native-library stripping is enabled by default and can be disabled with `VERCEL_PYTHON_STRIP_BINARIES=0`; it is skipped for cross-architecture builds when no compatible strip tool is available.
