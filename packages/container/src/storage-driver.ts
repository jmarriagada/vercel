import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isBuildContainer, readString, run } from './util';

export const BUILDAH_GRAPH_ROOT = '/var/lib/containers/storage';
export const BUILDAH_RUN_ROOT = '/run/containers/storage';

/**
 * The storage driver we require in the build container. The cell is granted
 * privileged-equivalent capabilities (vercel/hive#2310) and the build image's
 * `/etc/containers/storage.conf` points buildah's graphroot at the XFS
 * `/var/lib/containers` cell volume (vercel/api#76567), so the native `overlay`
 * driver works there. `vfs` (slow full-copy) is a fallback we do not want
 * silently.
 */
export const REQUIRED_BUILD_CONTAINER_DRIVER = 'overlay';

async function hasBinary(name: string): Promise<boolean> {
  try {
    await run('which', [name], { quiet: true });
    return true;
  } catch {
    return false;
  }
}

let cachedStorageDriver: Promise<string | undefined> | undefined;

/** Test-only: clear the memoized driver so env changes take effect. */
export function __resetStorageDriverCache(): void {
  cachedStorageDriver = undefined;
}

/**
 * Pick a storage driver for container image builds.
 *
 * The intended steady state in the build cell is the native `overlay` driver on
 * the mounted XFS `/var/lib/containers` volume (configured via the build
 * image's `/etc/containers/storage.conf`). However, that volume is not yet
 * mounted on all cells, and native `overlay` cannot run on the cell's overlay
 * rootfs. So for now we pick a driver that works everywhere: fuse-overlayfs
 * when usable, otherwise vfs. `assertBuildContainerStorage()` reports (without
 * failing) whether we're on the intended overlay+XFS setup.
 *
 * Set `VERCEL_VCR_DEFER_STORAGE_CONF=1` to instead defer to storage.conf (don't
 * force a `--storage-driver`), once the volume is reliably mounted.
 *
 * `VERCEL_VCR_DOCKER_STORAGE_DRIVER` overrides the choice entirely.
 */
export function selectStorageDriver(): Promise<string | undefined> {
  if (!cachedStorageDriver) {
    cachedStorageDriver = (async () => {
      const override = readString(process.env.VERCEL_VCR_DOCKER_STORAGE_DRIVER);
      if (override) {
        return override;
      }
      if (readString(process.env.VERCEL_VCR_DEFER_STORAGE_CONF)) {
        // Defer to /etc/containers/storage.conf (native overlay on the volume).
        return undefined;
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

  // In the build container `driver` is undefined: defer to storage.conf so the
  // native overlay driver (on the XFS volume) is used. Don't pass
  // `--storage-driver`, which would override storage.conf.
  if (!driver) {
    return [...rootArgs, ...registriesArgs];
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

export interface BuildahStoreInfo {
  graphRoot: string;
  runRoot: string;
  driver: string;
  backingFs: string;
}

/**
 * Read buildah's effective image store via `buildah info`.
 */
export async function readBuildahStoreInfo(): Promise<
  BuildahStoreInfo | undefined
> {
  const args = await buildahStorageArgs();
  const { stdout } = await run('buildah', [...args, 'info'], { quiet: true });
  const store = (JSON.parse(stdout) as { store?: Record<string, unknown> })
    .store;
  if (!store) {
    return undefined;
  }
  const graphStatus = store.GraphStatus as Record<string, string> | undefined;
  return {
    graphRoot: String(store.GraphRoot ?? ''),
    runRoot: String(store.RunRoot ?? ''),
    driver: String(store.GraphDriverName ?? ''),
    backingFs: String(
      graphStatus?.['Backing Filesystem'] ??
        graphStatus?.['Backing filesystem'] ??
        ''
    ),
  };
}

/**
 * In the build container, report whether buildah came up with the intended
 * storage: native `overlay` driver, graphroot on the mounted
 * `/var/lib/containers` volume, backed by a real (non-overlay) filesystem.
 *
 * This is observability-only by default: on a mismatch it logs loudly but does
 * NOT fail the build, because the volume mount is not yet applied on all cells
 * (it ships via the deployed api-build-containers-loop service, not the pinned
 * build-container image). Set `VERCEL_VCR_STRICT_STORAGE=1` to make a mismatch
 * a hard error once the volume is reliably mounted.
 *
 * No-op outside the build container.
 */
export async function assertBuildContainerStorage(
  log: (message: string) => void = () => {}
): Promise<void> {
  if (!isBuildContainer()) {
    return;
  }
  if (readString(process.env.VERCEL_VCR_DOCKER_STORAGE_DRIVER)) {
    // Operator explicitly chose a driver; don't second-guess it.
    return;
  }

  const strict = Boolean(readString(process.env.VERCEL_VCR_STRICT_STORAGE));

  let storeInfo: BuildahStoreInfo | undefined;
  try {
    storeInfo = await readBuildahStoreInfo();
  } catch (err) {
    // `buildah info` itself failing (e.g. overlay can't init on this fs) is the
    // very condition we're reporting on; surface it but don't block by default.
    const message = `Could not verify buildah storage via \`buildah info\`: ${
      (err as Error).message
    }`;
    if (strict) {
      throw new Error(message);
    }
    log(message);
    return;
  }
  if (!storeInfo) {
    const message =
      'Could not verify buildah storage: `buildah info` returned no store data.';
    if (strict) {
      throw new Error(message);
    }
    log(message);
    return;
  }

  const problems: string[] = [];
  if (storeInfo.driver !== REQUIRED_BUILD_CONTAINER_DRIVER) {
    problems.push(
      `storage driver is "${storeInfo.driver}", expected ` +
        `"${REQUIRED_BUILD_CONTAINER_DRIVER}"`
    );
  }
  if (storeInfo.graphRoot !== BUILDAH_GRAPH_ROOT) {
    problems.push(
      `graphRoot is "${storeInfo.graphRoot}", expected the mounted ` +
        `volume "${BUILDAH_GRAPH_ROOT}"`
    );
  }
  // The volume is XFS; an overlay backing fs would mean we're on the cell
  // rootfs, not the mounted volume (overlay-on-overlay).
  if (storeInfo.backingFs && storeInfo.backingFs === 'overlayfs') {
    problems.push(
      `backing filesystem is "${storeInfo.backingFs}" (the overlay rootfs), ` +
        'not the mounted volume'
    );
  }

  const summary =
    `buildah storage: driver=${storeInfo.driver} ` +
    `graphRoot=${storeInfo.graphRoot} runRoot=${storeInfo.runRoot} ` +
    `backingFs=${storeInfo.backingFs || '?'}`;

  if (problems.length === 0) {
    log(`${summary} \u2014 verified`);
    return;
  }

  const detail =
    `${summary}\nProblems: ${problems.join('; ')}.\n` +
    'Expected the native overlay driver on the XFS `/var/lib/containers` ' +
    'cell volume (requires vercel/hive#2310 capabilities + the ' +
    '`/var/lib/containers` cell-spec volume from vercel/api#76567).';

  if (strict) {
    throw new Error(
      `Container build storage is not configured as intended.\n${detail}`
    );
  }
  // Observability-only by default: log loudly, keep building.
  log(
    `${detail}\nContinuing (set VERCEL_VCR_STRICT_STORAGE=1 to fail builds).`
  );
}
