import { join } from 'path';
import { pathExists } from 'fs-extra';
import { debug, type DetectEntrypointFn } from '@vercel/build-utils';

export const GO_CANDIDATE_ENTRYPOINTS = [
  'main.go',
  'cmd/api/main.go',
  'cmd/server/main.go',
];

/**
 * Detect the Go entrypoint for standalone server mode.
 * Checks the configured entrypoint first, then searches candidate locations.
 */
export async function detectGoEntrypoint(
  workPath: string,
  configuredEntrypoint?: string
): Promise<string | null> {
  const entrypoint =
    configuredEntrypoint === '<detect>' ? undefined : configuredEntrypoint;

  // If the configured entrypoint exists, use it
  if (entrypoint && (await pathExists(join(workPath, entrypoint)))) {
    debug(`Using configured Go entrypoint: ${entrypoint}`);
    return entrypoint;
  }

  // Search candidate locations
  for (const candidate of GO_CANDIDATE_ENTRYPOINTS) {
    if (await pathExists(join(workPath, candidate))) {
      debug(`Detected Go entrypoint: ${candidate}`);
      return candidate;
    }
  }

  return null;
}

/**
 * Normalized entrypoint detector for Go services. Wraps {@link detectGoEntrypoint}
 * and returns the result in the shared {@link DetectedEntrypoint} shape consumed
 * by services auto-detection.
 */
export const detectEntrypoint: DetectEntrypointFn = async ({ workPath }) => {
  const file = await detectGoEntrypoint(workPath);
  if (!file) return null;
  return { kind: 'file', entrypoint: file };
};
