import type { Span } from '@vercel/build-utils';

export const VCR_REGISTRY = process.env.VERCEL_VCR_REGISTRY || 'vcr.vercel.com';

/** Images must target linux/amd64 — the only architecture currently supported. */
export const TARGET_PLATFORM = 'linux/amd64';

export const DIGEST_RE = /sha256:[a-f0-9]{64}/;

export interface BuildPushParams {
  contextDir: string;
  dockerfilePath: string;
  imageRef: string;
  registry: string;
  username: string;
  token: string;
  /** Bare repository name (without team/project prefix), for error messages. */
  repository: string;
  span?: Span;
}

/**
 * Pluggable container image toolchain. Docker is used on developer machines;
 * buildah is used in the Vercel build container (daemonless, smaller footprint).
 */
export interface ContainerEngine {
  readonly name: string;

  /** Verify the toolchain is installed and usable before build/login/push. */
  ensureReady(span?: Span): Promise<void>;

  /** Best-effort diagnostics; must not fail the build. */
  logDiagnostics(span?: Span): Promise<void>;

  /**
   * Prepare the runtime environment (e.g. start dockerd). No-op for daemonless
   * engines. The callback runs build/login/push inside this scope.
   */
  withRuntime<T>(span: Span | undefined, fn: () => Promise<T>): Promise<T>;

  build(params: BuildPushParams): Promise<void>;
  login(params: BuildPushParams): Promise<void>;
  push(params: BuildPushParams): Promise<string | undefined>;
}
