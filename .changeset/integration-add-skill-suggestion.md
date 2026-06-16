---
'vercel': minor
---

[cli] `integration add` now suggests a Claude Code skill from skills.sh after provisioning. If the product declares an agent skill, it prints a ready-to-run `npx skills add owner/repo@skill` command (normalizing a skills.sh or GitHub SKILL.md link to the exact skill id). Otherwise it falls back to `npx skills find "<provider>"` so the agent can discover and install the provider's skill. The suggestion is also surfaced as a `skill` field in `--format=json` output.
