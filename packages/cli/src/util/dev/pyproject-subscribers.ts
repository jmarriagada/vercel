import chalk from 'chalk';
import { cloneEnv } from '@vercel/build-utils';
import output from '../../output-manager';
import type { BuildMatch } from './types';
import type { DevQueueConsumer, DevQueueConsumerTopic } from './queue-broker';
import {
  startDevServerWithBuilder,
  type BuilderDevServerHandle,
} from './builder-dev-server';

interface PyprojectSubscriberDevControllerOptions {
  workPath: string;
  repoRoot: string;
  proxyOrigin: string;
  runEnv: NodeJS.ProcessEnv;
  pythonBuildMatch: BuildMatch;
}

export interface PyprojectSubscriberDevController {
  consumers: DevQueueConsumer[];
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
}

interface PythonDevQueueConsumerDescriptor {
  consumer: string;
  entrypoint: string;
  variableName: string;
  topics: DevQueueConsumerTopic[];
}

interface BuilderWithDevQueueConsumers {
  getDevQueueConsumers?: (options: {
    workPath: string;
  }) => Promise<PythonDevQueueConsumerDescriptor[]>;
}

function createPrefixedSink(label: string, stream: NodeJS.WriteStream) {
  const prefix = chalk.gray(`[${label}]`);
  let buffer = '';

  return (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line) {
        stream.write(`${prefix} ${line}\n`);
      }
    }
  };
}

export async function createPyprojectSubscriberDevController({
  workPath,
  repoRoot,
  proxyOrigin,
  runEnv,
  pythonBuildMatch,
}: PyprojectSubscriberDevControllerOptions): Promise<PyprojectSubscriberDevController | null> {
  const builder = pythonBuildMatch.builderWithPkg
    .builder as typeof pythonBuildMatch.builderWithPkg.builder &
    BuilderWithDevQueueConsumers;
  if (typeof builder.getDevQueueConsumers !== 'function') {
    return null;
  }

  const descriptors = await builder.getDevQueueConsumers({ workPath });
  if (descriptors.length === 0) {
    return null;
  }

  if (!builder.startDevServer) {
    throw new Error(
      'Python queue subscribers require a builder with startDevServer support.'
    );
  }

  const seenConsumers = new Set<string>();
  for (const descriptor of descriptors) {
    if (seenConsumers.has(descriptor.consumer)) {
      throw new Error(
        `Duplicate Python queue subscriber consumer "${descriptor.consumer}".`
      );
    }
    seenConsumers.add(descriptor.consumer);
  }

  const handles = new Map<string, BuilderDevServerHandle>();
  const consumers: DevQueueConsumer[] = descriptors.map(descriptor => ({
    name: descriptor.consumer,
    topics: descriptor.topics,
    getOrigin: () => handles.get(descriptor.consumer)?.origin ?? null,
  }));

  const framework =
    typeof pythonBuildMatch.config?.framework === 'string'
      ? pythonBuildMatch.config.framework
      : 'python';

  const workerEnv = cloneEnv(runEnv, {
    FORCE_COLOR: process.stdout.isTTY ? '1' : '0',
    BROWSER: 'none',
    VERCEL_HAS_WORKER_SERVICES: '1',
    VERCEL_SERVICE_TYPE: 'worker',
    VERCEL_SERVICE_TRIGGER: 'queue',
    VERCEL_QUEUE_BASE_URL: `${proxyOrigin}/_svc/_queues`,
    VERCEL_QUEUE_TOKEN: 'vc-dev-token',
  });

  return {
    consumers,
    async startAll() {
      let syncDependencies = true;
      for (const descriptor of descriptors) {
        output.debug(
          `Starting Python queue subscriber "${descriptor.consumer}" for topics ${descriptor.topics
            .map(topic => `"${topic.topic}"`)
            .join(', ')}`
        );

        const handle = await startDevServerWithBuilder({
          builder,
          entrypoint: descriptor.entrypoint,
          workPath,
          repoRootPath: repoRoot,
          config: {
            ...(pythonBuildMatch.config || {}),
            framework,
            handlerFunction: descriptor.variableName,
          },
          env: workerEnv,
          meta: {
            serviceCount: 0,
            pythonServiceCount: 1,
            syncDependencies,
            serviceName: `py-sub:${descriptor.consumer}`,
          },
          service: {
            name: descriptor.consumer,
            type: 'worker',
            trigger: 'queue',
          },
          onStdout: createPrefixedSink(descriptor.consumer, process.stdout),
          onStderr: createPrefixedSink(descriptor.consumer, process.stderr),
        });

        if (!handle) {
          throw new Error(
            `Python queue subscriber "${descriptor.consumer}" did not start.`
          );
        }

        syncDependencies = false;
        handles.set(descriptor.consumer, handle);
        output.debug(
          `Python queue subscriber "${descriptor.consumer}" listening at ${handle.origin}`
        );
      }
    },
    async stopAll() {
      await Promise.all(
        [...handles.values()].map(handle => handle.shutdown?.())
      );
      handles.clear();
    },
  };
}
