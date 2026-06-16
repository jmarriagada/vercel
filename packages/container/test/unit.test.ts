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
      project_id: 'prj_test',
      iss: 'https://oidc.vercel.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    })
  ).toString('base64url');
  return `eyJhbGciOiJSUzI1NiJ9.${payload}.sig`;
}

function stubRegistryFetch(
  fetchMock: ReturnType<typeof vi.fn>,
  options: { repositoryStatus?: number; mintStatus?: number } = {}
) {
  const repositoryStatus = options.repositoryStatus ?? 200;
  const mintStatus = options.mintStatus ?? 200;
  fetchMock.mockImplementation((url: string | URL) => {
    const href = String(url);
    if (href.includes('/v1/projects/') && href.includes('/token')) {
      const projectId =
        href.match(/\/projects\/([^/?]+)\/token/)?.[1] ?? 'prj_test';
      const token = fakeOidcToken({
        project_id: projectId,
        owner_id: 'team_test',
      });
      return Promise.resolve({
        ok: mintStatus >= 200 && mintStatus < 300,
        status: mintStatus,
        json: async () => ({ token }),
        text: async () =>
          mintStatus === 403 ? 'Forbidden' : JSON.stringify({ token }),
      });
    }
    if (href.includes('/v1/vcr/repository')) {
      return Promise.resolve({
        ok: repositoryStatus >= 200 && repositoryStatus < 300,
        status: repositoryStatus,
        text: async () => '',
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      text: async () => '',
    });
  });
}

/** Fake child process that exits with a failure code. */
function fakeChildFailure(stderr = '') {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: vi.fn() };
  setImmediate(() => {
    if (stderr) {
      child.stderr.emit('data', Buffer.from(stderr));
    }
    child.emit('close', 1);
  });
  return child;
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
  'VERCEL_TOKEN',
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
    /** Override the simulated `buildah info` store object. */
    storeInfo?: Record<string, unknown>;
  }) {
    if (options?.buildImageEnv) {
      process.env.VERCEL_BUILD_IMAGE = options.buildImageEnv;
    }
    if (options?.engineOverride) {
      process.env.VERCEL_CONTAINER_ENGINE = options.engineOverride;
    }
    process.env.VERCEL_OIDC_TOKEN = fakeOidcToken();
    const fetchMock = vi.fn();
    stubRegistryFetch(fetchMock);
    vi.stubGlobal('fetch', fetchMock);
    existsSyncMock.mockReturnValue(true);
    // Simulate `buildah info` reporting the intended store: native overlay on
    // the mounted XFS volume. Tests can override via `storeInfo`.
    const storeInfo = options?.storeInfo ?? {
      GraphRoot: '/var/lib/containers/storage',
      RunRoot: '/run/containers/storage',
      GraphDriverName: 'overlay',
      GraphStatus: { 'Backing Filesystem': 'xfs' },
    };
    const digest = `sha256:${'a'.repeat(64)}`;
    spawnMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'buildah' && args.includes('info')) {
        return fakeChild(JSON.stringify({ store: storeInfo }));
      }
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
    const loginIndex = commands.findIndex(c => c.includes('login'));
    const buildIndex = commands.findIndex(c => c.startsWith('docker build'));
    expect(loginIndex).toBeGreaterThanOrEqual(0);
    expect(buildIndex).toBeGreaterThan(loginIndex);
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
    // RUN steps must use host networking; the Hive cell can't program iptables
    // for buildah's default rootless network.
    expect(
      commands.some(c => /\bbuildah\b.*\bbuild\b.*--network host/.test(c))
    ).toBe(true);
    // Per-instruction layer caching must be enabled.
    expect(commands.some(c => /\bbuildah\b.*\bbuild\b.*--layers/.test(c))).toBe(
      true
    );
    expect(commands.some(c => /\bbuildah\b.*\blogin\b/.test(c))).toBe(true);
    expect(commands.some(c => /\bbuildah\b.*\bpush\b/.test(c))).toBe(true);
    // In the build container we defer to /etc/containers/storage.conf (native
    // overlay on the mounted volume); we must NOT force a --storage-driver.
    expect(commands.some(c => c.includes('--storage-driver'))).toBe(false);
    expect(commands.some(c => c.includes('--registries-conf'))).toBe(true);
    expect(
      commands.some(c => c.includes('--root /var/lib/containers/storage'))
    ).toBe(true);
    expect(commands.some(c => c.startsWith('docker build'))).toBe(false);
  });

  it('verifies buildah storage and fails when it is not overlay on the volume', async () => {
    // Simulate buildah falling back to vfs (e.g. overlay couldn't initialize).
    await expect(
      runDockerfileBuild({
        buildImageEnv: 'al2023',
        storeInfo: {
          GraphRoot: '/var/lib/containers/storage',
          RunRoot: '/run/containers/storage',
          GraphDriverName: 'vfs',
          GraphStatus: { 'Backing Filesystem': 'xfs' },
        },
      })
    ).rejects.toThrow(/storage driver is "vfs", expected "overlay"/);
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

    const fetchMock = vi.fn();
    stubRegistryFetch(fetchMock, { repositoryStatus: 200 });
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

    const fetchMock = vi.fn();
    stubRegistryFetch(fetchMock, { repositoryStatus: 409 });
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
    ).rejects.toThrow(/Missing VERCEL_OIDC_TOKEN/);
  });

  it('uses the existing OIDC token directly when no VERCEL_TOKEN is set', async () => {
    existsSyncMock.mockReturnValue(true);
    process.env.VERCEL_OIDC_TOKEN = fakeOidcToken({
      project_id: 'prj_test123',
    });
    const fetchMock = vi.fn();
    stubRegistryFetch(fetchMock);
    vi.stubGlobal('fetch', fetchMock);
    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('push')) {
        return fakeChild(
          `latest: digest: sha256:${'e'.repeat(64)} size: 1234\n`
        );
      }
      return fakeChild('');
    });

    await build({
      ...createBuildOptions({ runtime: 'container' }),
      service: { name: 'api', type: 'web' },
    });

    // An OIDC token cannot mint another OIDC token, so without a user/CLI auth
    // token (VERCEL_TOKEN) we must not call the project token-mint endpoint.
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/v1/projects/'),
      expect.anything()
    );
  });

  it('mints a fresh OIDC token when VERCEL_TOKEN is available', async () => {
    existsSyncMock.mockReturnValue(true);
    process.env.VERCEL_OIDC_TOKEN = fakeOidcToken({
      project_id: 'prj_test123',
    });
    process.env.VERCEL_TOKEN = 'cli-auth-token';
    const fetchMock = vi.fn();
    stubRegistryFetch(fetchMock);
    vi.stubGlobal('fetch', fetchMock);
    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('push')) {
        return fakeChild(
          `latest: digest: sha256:${'e'.repeat(64)} size: 1234\n`
        );
      }
      return fakeChild('');
    });

    await build({
      ...createBuildOptions({ runtime: 'container' }),
      service: { name: 'api', type: 'web' },
    });

    // The mint request must authenticate with the CLI auth token, not the OIDC
    // token.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/projects/prj_test123/token'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer cli-auth-token',
        }),
      })
    );
  });

  it('falls back to the existing OIDC token when minting fails', async () => {
    existsSyncMock.mockReturnValue(true);
    process.env.VERCEL_OIDC_TOKEN = fakeOidcToken({
      project_id: 'prj_test123',
    });
    process.env.VERCEL_TOKEN = 'cli-auth-token';
    const fetchMock = vi.fn();
    stubRegistryFetch(fetchMock, { mintStatus: 403 });
    vi.stubGlobal('fetch', fetchMock);
    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('push')) {
        return fakeChild(
          `latest: digest: sha256:${'e'.repeat(64)} size: 1234\n`
        );
      }
      return fakeChild('');
    });

    // A failed mint must not fail the build; it falls back to the existing token.
    await expect(
      build({
        ...createBuildOptions({ runtime: 'container' }),
        service: { name: 'api', type: 'web' },
      })
    ).resolves.toBeDefined();
  });

  it('fails before building when registry login is rejected', async () => {
    existsSyncMock.mockReturnValue(true);
    process.env.VERCEL_OIDC_TOKEN = fakeOidcToken({
      owner_id: 'team_TtmJZYmD3tcLBLqWOhoVawd1',
    });
    const fetchMock = vi.fn();
    stubRegistryFetch(fetchMock);
    vi.stubGlobal('fetch', fetchMock);
    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('login')) {
        return fakeChildFailure(
          'Error response from daemon: login attempt to https://vcr.vercel.com/v2/ failed with status: 403 Forbidden'
        );
      }
      return fakeChild('');
    });

    await expect(
      build({
        ...createBuildOptions({ runtime: 'container' }),
        service: { name: 'api', type: 'web' },
      })
    ).rejects.toThrow(/vercel-enable-vcr/);

    expect(
      spawnMock.mock.calls.some(([, args]) => args.includes('build'))
    ).toBe(false);
  });
});
