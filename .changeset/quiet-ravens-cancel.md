---
'vercel': patch
---

Allow Escape to cancel interactive `vercel link` prompts cleanly, add searchable
existing-project selection for teams with more than 100 projects, and pull
development environment variables automatically without overwriting existing
local variables. The post-SSO fallback team selection now supports substring
search by team name or slug.
