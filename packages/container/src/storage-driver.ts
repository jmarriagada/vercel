import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isBuildContainer, readString, run } from './util';

const BUILDAH_GRAPH_ROOT = '/var/lib/containers/storage';
const BUILDAH_RUN_ROOT = '/run/containers/storage';

async function hasBinary(name: string): Promise<boolean> {
  try {
    await run('which', [name], { quiet: true });
    return true;
  } catch {
    return false;
  }
}

let cachedStorageDriver: Promise<string> | undefined;

/**
 * Pick a storage driver for container image builds in the build cell. The cell
 * rootfs is overlay-backed, so the default overlay driver fails unless image
 * storage lives on the cell volume (`/var/lib/containers`) with vfs (or
 * fuse-overlayfs when `/dev/fuse` is available).
 */
export function selectStorageDriver(): Promise<string> {
  if (!cachedStorageDriver) {
    cachedStorageDriver = (async () => {
      const override = readString(process.env.VERCEL_VCR_DOCKER_STORAGE_DRIVER);
      if (override) {
        return override;
      }
      if (isBuildContainer()) {
        if ((await hasBinary('fuse-overlayfs')) && existsSync('/dev/fuse')) {
          return 'fuse-overlayfs';
        }
        return 'vfs';
      }
      if ((await hasBinary('fuse-overlayfs')) && existsSync('/dev/fuse')) {
        return 'fuse-overlayfs';
      }
      return 'vfs';
    })();
  }
  return cachedStorageDriver;
}

/**
 * AL2023 SPAL buildah defaults to `short-name-mode = enforcing`, which fails in
 * CI/build cells (no TTY) for Dockerfile `FROM` lines like `traefik/whoami`.
 * Pass an explicit registries.conf so unqualified names resolve via docker.io.
 */
const BUILDAH_REGISTRIES_CONF = `unqualified-search-registries = ["docker.io"]
short-name-mode = "permissive"
`;

let cachedRegistriesConfPath: string | undefined;

function buildahRegistriesConfPath(): string {
  if (!cachedRegistriesConfPath) {
    const dir = mkdtempSync(join(tmpdir(), 'vercel-container-registries-'));
    cachedRegistriesConfPath = join(dir, 'registries.conf');
    writeFileSync(cachedRegistriesConfPath, BUILDAH_REGISTRIES_CONF);
  }
  return cachedRegistriesConfPath;
}

/** Global buildah CLI flags (storage + registry resolution). */
export async function buildahStorageArgs(): Promise<string[]> {
  const driver = await selectStorageDriver();
  const rootArgs = isBuildContainer()
    ? ['--root', BUILDAH_GRAPH_ROOT, '--runroot', BUILDAH_RUN_ROOT]
    : [];

  const registriesArgs = [
    '--registries-conf',
    buildahRegistriesConfPath(),
  ] as const;

  if (driver === 'vfs') {
    return [...rootArgs, ...registriesArgs, '--storage-driver', 'vfs'];
  }
  if (driver === 'fuse-overlayfs') {
    return [
      ...rootArgs,
      ...registriesArgs,
      '--storage-driver',
      'overlay',
      '--storage-opt',
      'overlay.mount_program=/usr/bin/fuse-overlayfs',
    ];
  }
  return [...rootArgs, ...registriesArgs, '--storage-driver', driver];
}
