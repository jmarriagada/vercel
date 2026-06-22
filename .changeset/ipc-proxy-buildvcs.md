---
---

Disable Go VCS stamping (`-buildvcs=false`) when cross-compiling the IPC proxy binaries, so `pnpm build` works from a git worktree (Go otherwise fails with `error obtaining VCS status: exit status 128`).
