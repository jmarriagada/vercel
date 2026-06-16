import type { BuildResultV2Typical } from '@vercel/build-utils';
import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { build } from '../src';

const { spawnMock, existsSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  existsSyncMock: vi.fn(),
}));

vi.mock('node:child_process', async importActual => {
  const actual = await importActual<typeof import('node:child_process')>();
  return { ...actual, spawn: spawnMock };
});

vi.mock('node:fs', async importActual => {
  const actual = await importActual<typeof import('node:fs')>();
  return { ...actual, existsSync: existsSyncMock };
});

const createBuildOptions = (config: Record<string, unknown>) => ({
  files: {},
  entrypoint: 'docker.io/library/nginx:1.27',
  workPath: '/',
  repoRootPath: '/',
  config,
});

/** Build a fake (unsigned) OIDC JWT with the given claims. */
function fakeOidcToken(claims: Record<string, unknown> = {}) {
  const payload = Buffer.from(
    JSON.stringify({
      owner: 'acme',
      owner_id: 'team_test',
      project: 'my-app',
      ...claims,
    })
  ).toString('base64url');
  return `eyJhbGciOiJSUzI1NiJ9.${payload}.sig`;
}

/** Fake child process that emits the given stdout, then exits successfully. */
function fakeChild(stdout = '') {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: vi.fn() };
  setImmediate(() => {
    if (stdout) {
      child.stdout.emit('data', Buffer.from(stdout));
    }
    child.emit('close', 0);
  });
  return child;
}

const VCR_ENV_KEYS = [
  'VERCEL_OIDC_TOKEN',
  'VERCEL_API_URL',
  'VERCEL_BUILD_IMAGE',
  'VERCEL_CONTAINER_ENGINE',
];

beforeEach(() => {
  existsSyncMock.mockReturnValue(false);
  spawnMock.mockReset();
  for (const key of VCR_ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of VCR_ENV_KEYS) {
    delete process.env[key];
  }
  vi.unstubAllGlobals();
});

function expectTypicalBuildResult(
  result: Awaited<ReturnType<typeof build>>
): BuildResultV2Typical {
  expect(result).toHaveProperty('output');
  return result as BuildResultV2Typical;
}

describe('@vercel/container', () => {
  it('passes the container image reference through as build output', async () => {
    const result = await build(
      createBuildOptions({ handler: 'docker.io/library/nginx:1.27' })
    );

    expect(result).toEqual({
      output: {
        index: {
          type: 'Lambda',
          files: {},
          handler: 'docker.io/library/nginx:1.27',
          runtime: 'container',
          environment: {},
        },
      },
    });
  });

  it('does not rewrite image references without registry', async () => {
    const result = expectTypicalBuildResult(
      await build(createBuildOptions({ image: 'grycap/cowsay:latest' }))
    );

    expect(result.output.index).toMatchObject({
      handler: 'grycap/cowsay:latest',
      runtime: 'container',
    });
  });

  it('normalizes a string command override to argv array form', async () => {
    const result = expectTypicalBuildResult(
      await build(
        createBuildOptions({
          image: 'docker.io/library/nginx:1.27',
          command: 'nginx -g daemon off;',
        })
      )
    );

    expect(result.output.index).toMatchObject({
      handler: 'docker.io/library/nginx:1.27',
      command: ['nginx -g daemon off;'],
    });
  });

  it('emits service builds at the internal service function path', async () => {
    const result = expectTypicalBuildResult(
      await build({
        ...createBuildOptions({ image: 'docker.io/library/nginx:1.27' }),
        service: {
          name: 'api',
          type: 'web',
        },
      })
    );

    expect(result.output).toHaveProperty('_svc/api/index');
    expect(result.output['_svc/api/index']).toMatchObject({
      handler: 'docker.io/library/nginx:1.27',
      runtime: 'container',
      environment: {},
    });
  });

  async function runDockerfileBuild(options?: {
    buildImageEnv?: string;
    engineOverride?: string;
  }) {
    if (options?.buildImageEnv) {
      process.env.VERCEL_BUILD_IMAGE = options.buildImageEnv;
    }
    if (options?.engineOverride) {
      process.env.VERCEL_CONTAINER_ENGINE = options.engineOverride;
    }
    process.env.VERCEL_OIDC_TOKEN = fakeOidcToken();
    // Everything exists except /dev/fuse so storage-driver selection falls
    // back to vfs deterministically (otherwise fuse-overlayfs may be picked).
    existsSyncMock.mockImplementation((path: string) => path !== '/dev/fuse');
    const digest = `sha256:${'a'.repeat(64)}`;
    spawnMock.mockImplementation((cmd: string, args: string[]) => {
      if (args.includes('push')) {
        if (cmd === 'buildah') {
          const digestIdx = args.indexOf('--digestfile');
          if (digestIdx >= 0) {
            writeFileSync(args[digestIdx + 1], `${digest}\n`);
          }
          return fakeChild('');
        }
        return fakeChild(`latest: digest: ${digest} size: 1234\n`);
      }
      return fakeChild('');
    });

    const result = expectTypicalBuildResult(
      await build({
        ...createBuildOptions({ runtime: 'container' }),
        service: { name: 'api', type: 'web' },
      })
    );

    expect(result.output['_svc/api/index']).toMatchObject({
      type: 'Lambda',
      runtime: 'container',
      handler: `vcr.vercel.com/acme/my-app/api@${digest}`,
    });

    return spawnMock.mock.calls.map(call => {
      const [cmd, args] = call as [string, string[]];
      return `${cmd} ${args.join(' ')}`;
    });
  }

  it('builds a Dockerfile with docker locally, pushes to VCR, and emits the digest reference', async () => {
    const commands = await runDockerfileBuild();
    expect(commands.some(c => c.startsWith('docker build'))).toBe(true);
    expect(
      commands.some(
        c =>
          c.includes('login') &&
          c.includes('--username team_test') &&
          c.includes('--password-stdin')
      )
    ).toBe(true);
    expect(
      commands.some(c =>
        c.startsWith('docker push vcr.vercel.com/acme/my-app/api')
      )
    ).toBe(true);
  });

  it('uses buildah in the Vercel build container', async () => {
    const commands = await runDockerfileBuild({
      buildImageEnv: 'al2023',
    });
    expect(commands.some(c => /\bbuildah\b.*\bbuild\b/.test(c))).toBe(true);
    expect(commands.some(c => /\bbuildah\b.*\blogin\b/.test(c))).toBe(true);
    expect(commands.some(c => /\bbuildah\b.*\bpush\b/.test(c))).toBe(true);
    expect(commands.some(c => c.includes('--storage-driver vfs'))).toBe(true);
    expect(commands.some(c => c.includes('--registries-conf'))).toBe(true);
    expect(
      commands.some(c => c.includes('--root /var/lib/containers/storage'))
    ).toBe(true);
    expect(commands.some(c => c.startsWith('docker build'))).toBe(false);
  });

  it('ensures the VCR repository exists before pushing', async () => {
    process.env.VERCEL_OIDC_TOKEN = fakeOidcToken({
      project_id: 'prj_test123',
    });
    existsSyncMock.mockReturnValue(true);
    const digest = `sha256:${'c'.repeat(64)}`;
    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('push')) {
        return fakeChild(`latest: digest: ${digest} size: 1234\n`);
      }
      return fakeChild('');
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    await build({
      ...createBuildOptions({ runtime: 'container' }),
      service: { name: 'api', type: 'web' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.vercel.com/v1/vcr/repository?teamId=team_test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'api', projectId: 'prj_test123' }),
      })
    );
  });

  it('treats a 409 from repository creation as already-exists', async () => {
    process.env.VERCEL_OIDC_TOKEN = fakeOidcToken({
      project_id: 'prj_test123',
    });
    existsSyncMock.mockReturnValue(true);
    const digest = `sha256:${'d'.repeat(64)}`;
    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('push')) {
        return fakeChild(`latest: digest: ${digest} size: 1234\n`);
      }
      return fakeChild('');
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => 'already exists',
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = expectTypicalBuildResult(
      await build({
        ...createBuildOptions({ runtime: 'container' }),
        service: { name: 'api', type: 'web' },
      })
    );

    expect(result.output['_svc/api/index']).toMatchObject({
      handler: `vcr.vercel.com/acme/my-app/api@${digest}`,
    });
  });

  it('fails the Dockerfile build when no OIDC token is available', async () => {
    existsSyncMock.mockReturnValue(true);
    spawnMock.mockImplementation(() => fakeChild(''));

    await expect(
      build({
        ...createBuildOptions({ runtime: 'container' }),
        service: { name: 'api', type: 'web' },
      })
    ).rejects.toThrow(/VERCEL_OIDC_TOKEN/);
  });
});
