---
'vercel': minor
---

[cli] `integration add` now suggests a Claude Code skill from skills.sh after provisioning. If the product declares an agent skill (`agentSkillUrl`), it prints a ready-to-run `npx skills add owner/repo@skill` command (normalizing a skills.sh or GitHub SKILL.md link to the exact skill id). Otherwise it looks the product up on skills.sh and suggests the skill only when a result is confidently published by the provider's own org — staying silent when there's no confident match. The suggestion is also surfaced as a `skill` field in `--format=json` output. The CLI only suggests the command; running `npx skills add` is left to the user/agent.
