---
'vercel': patch
---

`vercel blob store add` now honors non-interactive mode (the `--non-interactive` flag and agent auto-detection) instead of relying on TTY detection alone. In non-interactive mode it never prompts: required values (name, access) error out if missing, and the store is not linked to a project unless `--yes` is passed. This prevents the command from hanging on a prompt when run by an agent on a pseudo-TTY.
