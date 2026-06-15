import type { Span } from '@vercel/build-utils';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEBUG, debug, info, isBuildContainer, run, toTag } from '../util';
import type { BuildPushParams, ContainerEngine } from './types';
import { TARGET_PLATFORM } from './types';

function skopeoImageRef(imageRef: string): string {
  return imageRef.startsWith('docker://') ? imageRef : `docker://${imageRef}`;
}

export const buildahEngine: ContainerEngine = {
  name: 'buildah',

  async ensureReady(span?: Span): Promise<void> {
    try {
      const { stdout } = await run('buildah', ['--version'], { quiet: true });
      span?.setAttributes({ 'buildah.version': stdout.trim().split('\n')[0] });
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
      const version = (
        await run('buildah', ['--version'], { quiet: true })
      ).stdout.trim();
      let skopeoVersion = 'n/a';
      try {
        skopeoVersion = (
          await run('skopeo', ['--version'], { quiet: true })
        ).stdout.trim();
      } catch {
        // skopeo optional for diagnostics
      }

      info(`buildah: ${version.split('\n')[0] ?? version}`);
      debug(`skopeo: ${skopeoVersion.split('\n')[0] ?? skopeoVersion}`);

      span?.setAttributes({
        'container.engine': 'buildah',
        'buildah.version': toTag(version.split('\n')[0]),
        'skopeo.version': toTag(skopeoVersion.split('\n')[0]),
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
    await run('buildah', [
      'build',
      '--platform',
      TARGET_PLATFORM,
      '-t',
      params.imageRef,
      '-f',
      params.dockerfilePath,
      params.contextDir,
    ]);
  },

  async login(params: BuildPushParams): Promise<void> {
    try {
      await run(
        'buildah',
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
          [
            `Authentication to ${params.registry} as "${params.username}" was rejected.`,
            '',
            `Make sure your team ("${params.username}") is enrolled in the`,
            '`vercel-enable-vcr` flag and that the OIDC token is valid for it.',
            '',
            `Underlying error: ${message}`,
          ].join('\n')
        );
      }
      throw err;
    }
  },

  async push(params: BuildPushParams): Promise<string | undefined> {
    const digestDir = mkdtempSync(join(tmpdir(), 'vercel-container-digest-'));
    const digestFile = join(digestDir, 'digest');
    try {
      await run('buildah', [
        'push',
        '--digestfile',
        digestFile,
        params.imageRef,
      ]);
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

  async inspectRemoteImage(imageRef: string): Promise<void> {
    await run('skopeo', ['inspect', skopeoImageRef(imageRef)], { quiet: true });
  },
};
