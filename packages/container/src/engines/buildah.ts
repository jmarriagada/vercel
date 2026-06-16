import type { Span } from '@vercel/build-utils';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildahStorageArgs, selectStorageDriver } from '../storage-driver';
import { formatVcrAuthError } from '../oidc';
import { DEBUG, debug, info, isBuildContainer, run, toTag } from '../util';
import type { BuildPushParams, ContainerEngine } from './types';
import { TARGET_PLATFORM } from './types';

async function runBuildah(
  args: string[],
  opts: { input?: string; quiet?: boolean } = {}
) {
  const storageArgs = await buildahStorageArgs();
  return run('buildah', [...storageArgs, ...args], opts);
}

export const buildahEngine: ContainerEngine = {
  name: 'buildah',

  async ensureReady(span?: Span): Promise<void> {
    try {
      const storageDriver = await selectStorageDriver();
      const { stdout } = await runBuildah(['--version'], { quiet: true });
      span?.setAttributes({
        'buildah.version': stdout.trim().split('\n')[0],
        'buildah.storage_driver': storageDriver,
      });
    } catch (err) {
      const message = (err as Error).message;
      if (/Command not found/i.test(message)) {
        throw new Error(
          isBuildContainer()
            ? 'The `buildah` CLI is not available in this build container. ' +
              'Install buildah (via SPAL) in the build image.'
            : 'Buildah was not found on your PATH. Install buildah or run the build ' +
              'on Vercel where the build container provides it.'
        );
      }
      throw err;
    }
  },

  async logDiagnostics(span?: Span): Promise<void> {
    try {
      const storageDriver = await selectStorageDriver();
      const version = (
        await runBuildah(['--version'], { quiet: true })
      ).stdout.trim();

      info(
        `buildah: ${version.split('\n')[0] ?? version} ` +
          `(storage-driver=${storageDriver})`
      );

      span?.setAttributes({
        'container.engine': 'buildah',
        'buildah.version': toTag(version.split('\n')[0]),
        'buildah.storage_driver': toTag(storageDriver),
      });
    } catch (err) {
      debug(`buildah diagnostics unavailable: ${(err as Error).message}`);
    }
  },

  async withRuntime<T>(
    _span: Span | undefined,
    fn: () => Promise<T>
  ): Promise<T> {
    return fn();
  },

  async build(params: BuildPushParams): Promise<void> {
    await runBuildah([
      'build',
      '--platform',
      TARGET_PLATFORM,
      // Use the host network namespace for RUN steps. The build runs inside a
      // restricted Hive cell that cannot program iptables, so buildah's default
      // rootless networking (netavark) fails with
      // "netavark: iptables ... Could not fetch rule set generation id".
      // Host networking skips per-container network setup and reuses the cell's
      // existing egress.
      '--network',
      'host',
      '-t',
      params.imageRef,
      '-f',
      params.dockerfilePath,
      params.contextDir,
    ]);
  },

  async login(params: BuildPushParams): Promise<void> {
    try {
      await runBuildah(
        [
          'login',
          params.registry,
          '--username',
          params.username,
          '--password-stdin',
        ],
        { input: params.token, quiet: !DEBUG }
      );
    } catch (err) {
      const message = (err as Error).message;
      if (/denied|forbidden|unauthorized|401|403/i.test(message)) {
        throw new Error(
          formatVcrAuthError(
            params.registry,
            params.username,
            `Underlying error: ${message}`
          )
        );
      }
      throw err;
    }
  },

  async reportStorage(span?: Span): Promise<void> {
    if (!DEBUG) {
      return;
    }
    try {
      const { stdout } = await runBuildah(['info'], { quiet: true });
      const store = (JSON.parse(stdout) as { store?: Record<string, unknown> })
        .store;
      if (!store) {
        debug('buildah info: no `store` field in output');
        return;
      }
      const graphRoot = String(store.GraphRoot ?? '?');
      const runRoot = String(store.RunRoot ?? '?');
      const driver = String(store.GraphDriverName ?? '?');
      // GraphStatus often reports the backing filesystem, e.g. "Backing Filesystem: xfs".
      const graphStatus = store.GraphStatus as
        | Record<string, string>
        | undefined;
      const backingFs =
        graphStatus?.['Backing Filesystem'] ??
        graphStatus?.['Backing filesystem'] ??
        '?';
      const imageStore = store.ImageStore as { number?: number } | undefined;

      info(
        `buildah storage: graphRoot=${graphRoot} runRoot=${runRoot} ` +
          `driver=${driver} backingFs=${backingFs}` +
          (imageStore?.number !== undefined
            ? ` images=${imageStore.number}`
            : '')
      );
      span?.setAttributes({
        'buildah.storage.graph_root': graphRoot,
        'buildah.storage.run_root': runRoot,
        'buildah.storage.driver': driver,
        'buildah.storage.backing_fs': backingFs,
      });
    } catch (err) {
      debug(`buildah storage report unavailable: ${(err as Error).message}`);
    }
  },

  async push(params: BuildPushParams): Promise<string | undefined> {
    const digestDir = mkdtempSync(join(tmpdir(), 'vercel-container-digest-'));
    const digestFile = join(digestDir, 'digest');
    try {
      await runBuildah(['push', '--digestfile', digestFile, params.imageRef]);
      const digest = readFileSync(digestFile, 'utf8').trim();
      return digest.match(/sha256:[a-f0-9]{64}/)?.[0] ?? (digest || undefined);
    } catch (err) {
      const message = (err as Error).message;
      if (
        /denied|forbidden|unauthorized|not found|401|403|404/i.test(message)
      ) {
        throw new Error(
          [
            `Pushing ${params.imageRef} was denied.`,
            '',
            `The build tried to ensure the "${params.repository}" repository exists, but`,
            'the push was still rejected. Verify access (or create the repository under',
            "your project's Sandboxes → Container Registry tab), then re-run the build.",
            '',
            `Underlying error: ${message}`,
          ].join('\n')
        );
      }
      throw err;
    } finally {
      rmSync(digestDir, { recursive: true, force: true });
    }
  },
};
