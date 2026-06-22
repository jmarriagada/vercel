---
'vercel': patch
---

Allow Escape to cancel interactive `vercel link` prompts cleanly, add searchable
existing-project selection for teams with more than 100 projects, and pull
development environment variables automatically while preserving existing local
values and refreshing the CLI-managed `VERCEL_OIDC_TOKEN`. The post-SSO
fallback team selection now supports substring search by team name or slug.
