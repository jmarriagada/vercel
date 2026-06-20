import type { ExperimentalService } from '@vercel/fs-detectors';
import { isPythonFramework } from '@vercel/build-utils';
import output from '../../output-manager';
import type { BuildMatch } from './types';

interface DevQueueSubscriber {
  consumer: string;
  entrypoint: string;
  variableName: string;
  topics: NonNullable<ExperimentalService['topics']>;
}

interface BuilderWithDevQueueSubscribers {
  getDevQueueSubscribers?: (options: {
    workPath: string;
  }) => Promise<DevQueueSubscriber[]>;
}

function getStandalonePythonFrameworkBuildMatch(
  buildMatches: Iterable<BuildMatch>
): BuildMatch | null {
  const matches = [...buildMatches].filter(match => {
    const framework =
      typeof match.config?.framework === 'string'
        ? match.config.framework
        : undefined;
    return (
      (match.use === '@vercel/python' ||
        match.builderWithPkg.pkg.name === '@vercel/python') &&
      match.config?.middleware !== true &&
      isPythonFramework(framework)
    );
  });

  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    output.debug(
      `Skipping pyproject subscribers: expected one Python framework build match, found ${matches.length}`
    );
    return null;
  }
  return matches[0];
}

export async function getPyprojectSubscriberServices({
  buildMatches,
  workPath,
}: {
  buildMatches: Iterable<BuildMatch>;
  workPath: string;
}): Promise<ExperimentalService[]> {
  const match = getStandalonePythonFrameworkBuildMatch(buildMatches);
  if (!match) {
    return [];
  }

  const builder = match.builderWithPkg
    .builder as typeof match.builderWithPkg.builder &
    BuilderWithDevQueueSubscribers;

  if (typeof builder.getDevQueueSubscribers !== 'function') {
    return [];
  }

  const descriptors = await builder.getDevQueueSubscribers({ workPath });
  const framework = match.config?.framework || 'python';

  return descriptors.map(descriptor => ({
    schema: 'experimentalServices',
    name: descriptor.consumer,
    type: 'worker',
    trigger: 'queue',
    workspace: '.',
    framework,
    runtime: 'python',
    builder: {
      use: match.use || '@vercel/python',
      src: descriptor.entrypoint,
      config: {
        handlerFunction: descriptor.variableName,
      },
    },
    topics: descriptor.topics,
  }));
}
