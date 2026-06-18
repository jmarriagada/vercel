import { isErrnoException } from '@vercel/error-utils';
import ms from 'ms';
import type { Deployment } from '@vercel-internals/types';
import type Client from '../../util/client';
import { createGitMeta } from '../../util/create-git-meta';
import { printError } from '../../util/error';
import {
  DeploymentNotFound,
  DeploymentPermissionDenied,
  InvalidDeploymentId,
  isAPIError,
} from '../../util/errors-ts';
import { parseArguments } from '../../util/get-args';
import { getFlagsSpecification } from '../../util/get-flags-specification';
import getScope from '../../util/get-scope';
import { getCommandName, getCommandNamePlain } from '../../util/pkg-name';
import { getLinkedProject } from '../../util/projects/link';
import { ShareTelemetryClient } from '../../util/telemetry/commands/share';
import { getLatestDeploymentByBranch } from '../../util/deploy/get-latest-deployment-by-branch';
import {
  buildCommandWithYes,
  outputActionRequired,
} from '../../util/agent-output';
import toHost from '../../util/to-host';
import output from '../../output-manager';
import { help } from '../help';
import { shareCommand } from './command';

interface ProtectionBypassResponse {
  protectionBypass?: Record<string, { scope?: string }>;
}

const MAX_TTL_SECONDS = 63_072_000;

export default async function share(client: Client): Promise<number> {
  const telemetry = new ShareTelemetryClient({
    opts: {
      store: client.telemetryEventStore,
    },
  });

  const flagsSpecification = getFlagsSpecification(shareCommand.options);

  let parsedArguments;
  try {
    parsedArguments = parseArguments(client.argv.slice(2), flagsSpecification);
  } catch (err) {
    printError(err);
    return 1;
  }

  if (parsedArguments.flags['--help']) {
    telemetry.trackCliFlagHelp('share');
    output.print(help(shareCommand, { columns: client.stderr.columns }));
    return 2;
  }

  if (parsedArguments.args[0] === shareCommand.name) {
    parsedArguments.args.shift();
  }

  const [target] = parsedArguments.args;

  if (parsedArguments.args.length > 1) {
    output.error(
      `${getCommandName('share <url|deploymentId>')} accepts at most one argument`
    );
    return 1;
  }

  telemetry.trackCliArgumentUrlOrDeploymentId(target);
  telemetry.trackCliFlagYes(parsedArguments.flags['--yes']);
  telemetry.trackCliOptionTtl(parsedArguments.flags['--ttl']);

  const ttl = parseTTL(parsedArguments.flags['--ttl']);
  if (ttl instanceof Error) {
    output.error(ttl.message);
    return 1;
  }

  let contextName: string;
  let scopeTeamId: string | undefined;
  let userId: string;

  try {
    const scope = await getScope(client);
    contextName = scope.contextName;
    scopeTeamId = scope.team?.id;
    userId = scope.user.id;
  } catch (err: unknown) {
    if (
      isErrnoException(err) &&
      (err.code === 'NOT_AUTHORIZED' || err.code === 'TEAM_DELETED')
    ) {
      output.error(err.message);
      return 1;
    }

    throw err;
  }

  let deploymentId: string;
  let baseUrl: string;
  let accountId: string;

  if (target) {
    try {
      const selectedAccountId = scopeTeamId ?? userId;
      const deployment = await getDeploymentForShare(
        client,
        contextName,
        target,
        selectedAccountId
      );
      deploymentId = deployment.id;
      accountId = deployment.ownerId ?? selectedAccountId;
      baseUrl = getShareBaseUrl(target, deployment.url);
    } catch (err) {
      if (err instanceof DeploymentNotFound) {
        output.error(`Deployment not found: ${target}`);
        return 1;
      }
      if (err instanceof InvalidDeploymentId) {
        output.error(`Invalid deployment ID: ${target}`);
        return 1;
      }
      if (err instanceof DeploymentPermissionDenied) {
        output.error(err.message);
        return 1;
      }
      throw err;
    }
  } else {
    const linkedProject = await getLinkedProject(client, client.cwd);
    if (linkedProject.status === 'error') {
      return linkedProject.exitCode;
    }

    if (
      linkedProject.status !== 'linked' ||
      !linkedProject.project ||
      !linkedProject.org
    ) {
      output.error(
        `No linked project found. Run ${getCommandName(
          'link'
        )} or pass a deployment URL or ID.`
      );
      return 1;
    }

    const gitMeta = await createGitMeta(
      linkedProject.repoRoot ?? client.cwd,
      linkedProject.project
    );
    const branch = gitMeta?.commitRef;

    if (!branch) {
      output.error(
        'Could not detect the current git branch. Pass a deployment URL or ID, or run this command from a git repository.'
      );
      return 1;
    }

    const branchDeployment = await getLatestDeploymentByBranch(
      client,
      linkedProject.project.id,
      branch,
      linkedProject.org.id
    );

    if (!branchDeployment) {
      const latestBranchDeployment = await getLatestDeploymentByBranch(
        client,
        linkedProject.project.id,
        branch,
        linkedProject.org.id,
        { readyOnly: false }
      );

      if (latestBranchDeployment) {
        output.error(
          `Latest deployment for branch "${branch}" is not ready: https://${latestBranchDeployment.url} (${latestBranchDeployment.readyState ?? 'UNKNOWN'}). Fix the deployment first or pass a deployment URL or ID.`
        );
        return 1;
      }

      output.error(
        `No deployments found for branch "${branch}". Deploy this branch first or pass a deployment URL or ID.`
      );
      return 1;
    }

    accountId = linkedProject.org.id;
    deploymentId = branchDeployment.id;
    baseUrl = `https://${branchDeployment.url}`;
  }

  const approved = await confirmShareCreation(
    client,
    baseUrl,
    Boolean(parsedArguments.flags['--yes'])
  );
  if (!approved) {
    return 0;
  }

  return await createShareUrl(client, deploymentId, baseUrl, ttl, accountId);
}

async function confirmShareCreation(
  client: Client,
  baseUrl: string,
  autoConfirm: boolean
): Promise<boolean> {
  if (autoConfirm) {
    return true;
  }

  if (!client.stdin.isTTY) {
    if (client.nonInteractive) {
      outputActionRequired(
        client,
        {
          status: 'action_required',
          reason: 'confirmation_required',
          message: `Command ${getCommandNamePlain('share')} requires confirmation. Use option --yes to confirm.`,
          next: [
            {
              command: buildCommandWithYes(client.argv),
              when: 'Confirm and run',
            },
          ],
        },
        1
      );
    } else {
      output.error(
        'Confirmation required. Use `--yes` to skip the confirmation prompt in non-interactive mode.'
      );
    }
    return false;
  }

  output.log(
    `This will create a shareable link that bypasses deployment protection for ${baseUrl}.`
  );

  const confirmed = await client.input.confirm(
    'Are you sure you want to continue?',
    false
  );

  if (!confirmed) {
    output.log('Canceled');
  }

  return confirmed;
}

async function createShareUrl(
  client: Client,
  deploymentId: string,
  baseUrl: string,
  ttl: number | undefined,
  accountId: string
): Promise<number> {
  try {
    const response = await client.fetch<ProtectionBypassResponse>(
      `/v1/aliases/${encodeURIComponent(deploymentId)}/protection-bypass`,
      {
        method: 'PATCH',
        body: ttl === undefined ? {} : { ttl },
        accountId,
      }
    );

    const token = extractShareToken(response);
    const shareUrl = new URL(baseUrl);
    shareUrl.searchParams.set('_vercel_share', token);

    client.stdout.write(`${shareUrl.toString()}\n`);
    return 0;
  } catch (err: unknown) {
    if (isAPIError(err)) {
      output.error(err.message);
      return 1;
    }

    output.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

async function getDeploymentForShare(
  client: Client,
  contextName: string,
  target: string,
  selectedAccountId: string
): Promise<Deployment> {
  const hostOrId = target.includes('.') ? toHost(target) : target;
  let lookupError: unknown;

  for (const options of [
    { accountId: selectedAccountId },
    { useCurrentTeam: false },
  ] as const) {
    try {
      return await client.fetch<Deployment>(
        `/v13/deployments/${encodeURIComponent(hostOrId)}`,
        options
      );
    } catch (err: unknown) {
      if (!isAPIError(err) || (err.status !== 403 && err.status !== 404)) {
        lookupError = err;
        break;
      }

      if (!lookupError || err.status === 403) {
        lookupError = err;
      }
    }
  }

  if (isAPIError(lookupError)) {
    if (lookupError.status === 404) {
      throw new DeploymentNotFound({ id: hostOrId, context: contextName });
    }
    if (lookupError.status === 403) {
      throw new DeploymentPermissionDenied(hostOrId, contextName);
    }
    if (lookupError.status === 400 && lookupError.message.includes('`id`')) {
      throw new InvalidDeploymentId(hostOrId);
    }
  }

  throw lookupError;
}

function getShareBaseUrl(target: string, deploymentUrl: string): string {
  if (!target.includes('.')) {
    return `https://${deploymentUrl}`;
  }

  const url = new URL(
    /^[a-z][a-z\d+.-]*:\/\//i.test(target) ? target : `https://${target}`
  );
  url.protocol = 'https:';

  return url.pathname === '/' && !url.search && !url.hash
    ? url.origin
    : url.toString();
}

function parseTTL(value: string | undefined): number | Error | undefined {
  if (!value) {
    return undefined;
  }

  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    if (!Number.isSafeInteger(seconds) || seconds <= 0) {
      return new Error('Invalid TTL. Provide a positive number of seconds.');
    }
    return validateTTLMaximum(seconds);
  }

  const duration = ms(value);
  if (duration === undefined || duration < 1000) {
    return new Error(
      'Invalid TTL. Provide a positive duration like "30m", "1h", or seconds such as "3600".'
    );
  }

  return validateTTLMaximum(Math.ceil(duration / 1000));
}

function validateTTLMaximum(seconds: number): number | Error {
  if (seconds > MAX_TTL_SECONDS) {
    return new Error(
      `Invalid TTL. The maximum duration is ${MAX_TTL_SECONDS} seconds (730d).`
    );
  }

  return seconds;
}

function extractShareToken(response: ProtectionBypassResponse): string {
  const entries = Object.entries(response.protectionBypass ?? {});
  const token =
    entries.find(([, bypass]) => bypass.scope === 'shareable-link')?.[0] ??
    (entries.length === 1 ? entries[0][0] : undefined);

  if (!token) {
    throw new Error('Failed to create a share token for this deployment.');
  }

  return token;
}
