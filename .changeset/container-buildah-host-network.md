---
'@vercel/container': patch
---

Build container images with `buildah build --network host`. The build runs in a
restricted Hive cell that cannot program iptables, so buildah's default rootless
networking (netavark) fails during `RUN` steps with
`netavark: iptables ... Could not fetch rule set generation id`. Host networking
skips per-container network setup and reuses the cell's existing egress.
