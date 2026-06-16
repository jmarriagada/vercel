---
'vercel': patch
---

Improve CLI version output: the native binary now prints `Vercel CLI <version>` without the Node.js suffix, and `vercel upgrade` reports the version it upgraded to and says "No upgrade available" when already on the latest version.
