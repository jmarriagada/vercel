---
'@vercel/client': patch
'vercel': patch
---

Add `vercel deploy --dry-run` to inspect the local deployment file set without uploading or creating a deployment, with complete JSON output for non-TTY consumers.
