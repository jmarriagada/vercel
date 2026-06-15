import { existsSync } from 'node:fs';
import { readString, run } from './util';

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
 * storage lives on the cell volume (`/var/lib/containers`). When overlay still
 * cannot stack, prefer fuse-overlayfs (if `/dev/fuse` is available) or fall
 * back to vfs.
 */
export function selectStorageDriver(): Promise<string> {
  if (!cachedStorageDriver) {
    cachedStorageDriver = (async () => {
      const override = readString(process.env.VERCEL_VCR_DOCKER_STORAGE_DRIVER);
      if (override) {
        return override;
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
  if (driver === 'vfs') {
    return ['--storage-driver', 'vfs'];
  }
  if (driver === 'fuse-overlayfs') {
    return [
      '--storage-driver',
      'overlay',
      '--storage-opt',
      'overlay.mount_program=/usr/bin/fuse-overlayfs',
    ];
  }
  return ['--storage-driver', driver];
}
