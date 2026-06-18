---
'@vercel/cli-exec': major
---

Improve project-local `vercel` binary lookup fidelity by resolving only through the local `vercel` package, stopping lookup at project boundaries, and skipping directories that have unsafe ownership or access mode.  Major bump, because `findVercelCli` has been made async and `clearVercelCliCache` renamed to `clearVercelCliLookupCache`.  It is also substantially a complete rewrite.
