---
'@vercel/build-utils': patch
'@vercel/fs-detectors': patch
'@vercel/container': patch
'vercel': patch
---

Add an experimental container service runtime that builds a service's Dockerfile and pushes the resulting OCI image to the Vercel Container Registry (VCR), or passes a prebuilt image reference through as build output.

- `@vercel/container`: New builder that authenticates to VCR with the project's OIDC token, builds and pushes the image, and waits for it to become ready. Uses docker on developer machines and buildah (daemonless) in the Vercel build container, behind a shared `ContainerEngine` interface. The build flow is instrumented with tracing spans carrying non-secret diagnostics, with debug logging gated on `BUILDER_DEBUG` like other builders.
- `vercel`: Ensure a fresh OIDC token reaches the builder during `vercel build` — the refresh path now uses the correct linked project id and never passes a known-expired token to builders.
