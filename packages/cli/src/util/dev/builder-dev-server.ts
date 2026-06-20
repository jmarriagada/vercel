import ms from 'ms';
import type {
  BuilderV2,
  BuilderV3,
  BuilderVX,
  Config,
  Cron,
  StartDevServerOptions,
} from '@vercel/build-utils';
import { checkForPort } from './port-utils';
import { injectNextDevWebSocketShimIfNeeded } from './next-dev-websocket-shim-injection';

const STARTUP_TIMEOUT = ms('5m');

type BuilderWithDevServer = BuilderV2 | BuilderV3 | BuilderVX;

export interface BuilderDevServerHandle {
  origin: string;
  host: string;
  port: number;
  pid: number;
  shutdown?: () => Promise<void>;
  crons?: Cron[];
}

export async function startDevServerWithBuilder({
  builder,
  entrypoint,
  workPath,
  repoRootPath,
  config,
  env,
  meta,
  service,
  onStdout,
  onStderr,
  frameworkDevCommand,
  frameworkSlug,
}: {
  builder: BuilderWithDevServer;
  entrypoint: string;
  workPath: string;
  repoRootPath: string;
  config: Config;
  env: NodeJS.ProcessEnv;
  meta: Record<string, unknown>;
  service: StartDevServerOptions['service'];
  onStdout?: (data: Buffer) => void;
  onStderr?: (data: Buffer) => void;
  frameworkDevCommand?: string;
  frameworkSlug?: string;
}): Promise<BuilderDevServerHandle | null> {
  if (!builder.startDevServer) {
    return null;
  }

  injectNextDevWebSocketShimIfNeeded(env, frameworkDevCommand || '', {
    framework: frameworkSlug,
  });

  const result = await builder.startDevServer({
    entrypoint,
    workPath,
    repoRootPath,
    config,
    meta: {
      isDev: true,
      ...meta,
      env,
    },
    service,
    files: {},
    onStdout,
    onStderr,
  });

  if (!result) {
    return null;
  }

  const host = await checkForPort(result.port, STARTUP_TIMEOUT);
  return {
    origin: `http://${host}:${result.port}`,
    host,
    port: result.port,
    pid: result.pid,
    shutdown: result.shutdown,
    crons: result.crons,
  };
}
