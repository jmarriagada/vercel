---
'vercel': patch
---

The `vercel blob` store commands now honor non-interactive mode (the `--non-interactive` flag and agent auto-detection) instead of relying on TTY detection alone. This prevents the commands from hanging on a prompt when run by an agent on a pseudo-TTY. In non-interactive mode they never prompt:

- `create-store`: required values (name, access) error out if missing, and the store is not linked to a project unless `--yes` is passed.
- `get-store` / `delete-store`: a missing store ID errors out instead of prompting.
- `delete-store` / `empty-store`: the destructive confirmation is skipped only with `--yes`; otherwise the command errors instead of prompting.
- `list-stores`: prints the table instead of showing an interactive store picker.
