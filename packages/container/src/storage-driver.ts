import { existsSync } from 'node:fs';
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

/** Global buildah CLI flags for the selected storage driver. */
export async function buildahStorageArgs(): Promise<string[]> {
  const driver = await selectStorageDriver();
  const rootArgs = isBuildContainer()
    ? ['--root', BUILDAH_GRAPH_ROOT, '--runroot', BUILDAH_RUN_ROOT]
    : [];

  if (driver === 'vfs') {
    return [...rootArgs, '--storage-driver', 'vfs'];
  }
  if (driver === 'fuse-overlayfs') {
    return [
      ...rootArgs,
      '--storage-driver',
      'overlay',
      '--storage-opt',
      'overlay.mount_program=/usr/bin/fuse-overlayfs',
    ];
  }
  return [...rootArgs, '--storage-driver', driver];
}
