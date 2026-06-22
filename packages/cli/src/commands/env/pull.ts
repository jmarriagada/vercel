import chalk from 'chalk';
import { parse as parseDotenv } from 'dotenv';
import { outputFile, readFile } from 'fs-extra';
import { closeSync, openSync, readSync } from 'fs';
import { resolve } from 'path';
import type Client from '../../util/client';
import param from '../../util/output/param';
import { getCommandName, getCommandNamePlain } from '../../util/pkg-name';
import {
  type EnvRecordsSource,
  pullEnvRecords,
} from '../../util/env/get-env-records';
import {
  buildDeltaString,
  createEnvObject,
} from '../../util/env/diff-env-files';
import { VERCEL_OIDC_TOKEN } from '../../util/env/constants';
import { isErrnoException } from '@vercel/error-utils';
import { addToGitIgnore } from '../../util/link/add-to-gitignore';
import JSONparse from 'json-parse-better-errors';
import { formatProject } from '../../util/projects/format-project';
import type { ProjectLinked } from '@vercel-internals/types';
import output from '../../output-manager';
import { EnvPullTelemetryClient } from '../../util/telemetry/commands/env/pull';
import { pullSubcommand } from './command';
import { parseArguments } from '../../util/get-args';
import { getFlagsSpecification } from '../../util/get-flags-specification';
import { printError } from '../../util/error';
import parseTarget from '../../util/parse-target';
import { getLinkedProject } from '../../util/projects/link';
import { isAPIError } from '../../util/errors-ts';
import { performDeviceCodeFlow } from '../login/future';
import {
  buildCommandWithYes,
  getPreservedArgsForEnvPull,
  outputActionRequired,
  outputAgentError,
} from '../../util/agent-output';
import { printAlignedLabel } from '../../util/output/print-aligned-label';

const CONTENTS_PREFIX = '# Created by Vercel CLI\n';
const LINK_ENV_BLOCK_PREFIX = '# Vercel CLI environment variables\n';
const LINK_ENV_BLOCK_SUFFIX = '# End Vercel CLI environment variables\n';

export interface EnvPullOptions {
  preserveExisting?: boolean;
}

function readHeadSync(path: string, length: number) {
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, 'r');
  try {
    readSync(
      fd,
      buffer as unknown as NodeJS.ArrayBufferView,
      0,
      buffer.length,
      null
    );
  } finally {
    closeSync(fd);
  }
  return buffer.toString();
}

function tryReadHeadSync(path: string, length: number) {
  try {
    return readHeadSync(path, length);
  } catch (err: unknown) {
    if (!isErrnoException(err) || err.code !== 'ENOENT') {
      throw err;
    }
  }
}

const VARIABLES_TO_IGNORE = [
  'VERCEL_ANALYTICS_ID',
  'VERCEL_SPEED_INSIGHTS_ID',
  'VERCEL_WEB_ANALYTICS_ID',
];

export default async function pull(
  client: Client,
  argv: string[],
  source: EnvRecordsSource = 'vercel-cli:env:pull',
  options: EnvPullOptions = {}
) {
  const telemetryClient = new EnvPullTelemetryClient({
    opts: {
      store: client.telemetryEventStore,
    },
  });

  let parsedArgs;
  const flagsSpecification = getFlagsSpecification(pullSubcommand.options);
  try {
    parsedArgs = parseArguments(argv, flagsSpecification);
  } catch (err) {
    printError(err);
    return 1;
  }

  const { args, flags: opts } = parsedArgs;

  if (args.length > 1) {
    output.error(
      `Invalid number of arguments. Usage: ${getCommandName(`env pull <file>`)}`
    );
    return 1;
  }

  // handle relative or absolute filename
  const [rawFilename] = args;
  const filename = rawFilename || '.env.local';
  const skipConfirmation = opts['--yes'];
  const gitBranch = opts['--git-branch'];

  telemetryClient.trackCliArgumentFilename(args[0]);
  telemetryClient.trackCliFlagYes(skipConfirmation);
  telemetryClient.trackCliOptionGitBranch(gitBranch);
  telemetryClient.trackCliOptionEnvironment(opts['--environment']);
  telemetryClient.trackCliOptionId(opts['--id']);

  const link = await getLinkedProject(client);
  if (link.status === 'error') {
    return link.exitCode;
  } else if (link.status === 'not_linked') {
    if (client.nonInteractive) {
      const preserved = getPreservedArgsForEnvPull(client.argv);
      const linkArgv = [
        ...client.argv.slice(0, 2),
        'link',
        '--scope',
        '<scope>',
        ...preserved,
      ];
      outputAgentError(
        client,
        {
          status: 'error',
          reason: 'not_linked',
          message: `Your codebase isn't linked to a project on Vercel. Run ${getCommandNamePlain(
            'link'
          )} to begin. Use --yes for non-interactive; use --scope or --project to specify team or project.`,
          next: [
            { command: buildCommandWithYes(linkArgv) },
            { command: buildCommandWithYes(client.argv) },
          ],
        },
        1
      );
    }
    output.error(
      `Your codebase isn’t linked to a project on Vercel. Run ${getCommandName(
        'link'
      )} to begin.`
    );
    return 1;
  }
  client.config.currentTeam =
    link.org.type === 'team' ? link.org.id : undefined;

  const deploymentId = opts['--id'];

  const environment =
    parseTarget({
      flagName: 'environment',
      flags: opts,
    }) || 'development';

  await envPullCommandLogic(
    client,
    filename,
    !!skipConfirmation,
    environment,
    link,
    gitBranch,
    client.cwd,
    source,
    deploymentId,
    options
  );

  return 0;
}

export async function envPullCommandLogic(
  client: Client,
  filename: string,
  skipConfirmation: boolean,
  environment: string,
  link: ProjectLinked,
  gitBranch: string | undefined,
  cwd: string,
  source: EnvRecordsSource,
  deploymentId?: string,
  { preserveExisting = false }: EnvPullOptions = {}
) {
  const fullPath = resolve(cwd, filename);
  const head = tryReadHeadSync(fullPath, Buffer.byteLength(CONTENTS_PREFIX));
  const exists = typeof head !== 'undefined';

  if (head === CONTENTS_PREFIX && !preserveExisting) {
    output.log(`Overwriting existing ${chalk.bold(filename)} file`);
  } else if (exists && !skipConfirmation && !preserveExisting) {
    if (client.nonInteractive) {
      outputActionRequired(client, {
        status: 'action_required',
        reason: 'env_file_exists',
        message: `File ${param(filename)} already exists and was not created by Vercel CLI. Use --yes to overwrite or specify a different filename.`,
        next: [
          {
            command: getCommandNamePlain(`env pull ${filename} --yes`),
            when: 'Overwrite this file',
          },
          {
            command: getCommandNamePlain('env pull <filename>'),
            when: 'Use a different filename',
          },
        ],
      });
    }
    if (
      !(await client.input.confirm(
        `Found existing file ${param(filename)}. Do you want to overwrite?`,
        false
      ))
    ) {
      output.log('Canceled');
      return;
    }
  }

  const projectSlugLink = formatProject(link.org.slug, link.project.name);

  const downloadMessage = gitBranch
    ? `Downloading \`${chalk.cyan(
        environment
      )}\` environment variables for ${projectSlugLink} and any overrides for branch ${chalk.cyan(
        gitBranch
      )}`
    : `Downloading \`${chalk.cyan(
        environment
      )}\` environment variables for ${projectSlugLink}`;

  output.log(downloadMessage);

  output.spinner('Downloading');

  const pullId = deploymentId || link.project.id;
  const pullResult = await pullEnvRecordsForEnvPull(client, pullId, source, {
    target: environment || 'development',
    gitBranch,
  });
  // When pulling by deployment ID, use buildEnv which always contains the full
  // set of env vars. The `env` dict may only contain decryption keys when large
  // env encryption is active (the actual values are in an encrypted blob for
  // Lambda runtime use).
  const records = deploymentId ? pullResult.buildEnv : pullResult.env;

  let deltaString = '';
  let oldEnv;
  if (exists && !preserveExisting) {
    oldEnv = await createEnvObject(fullPath);
    if (oldEnv) {
      // Removes any double quotes from `records`, if they exist
      // We need this because double quotes are stripped from the local .env file,
      // but `records` is already in the form of a JSON object that doesn't filter
      // double quotes.
      const newEnv = JSONparse(JSON.stringify(records).replace(/\\"/g, ''));
      deltaString = buildDeltaString(oldEnv, newEnv);
    }
  }

  let existingContents =
    preserveExisting && exists ? await readFile(fullPath, 'utf8') : undefined;

  if (existingContents && VERCEL_OIDC_TOKEN in records) {
    // OIDC is short-lived and managed by the CLI, so always refresh it.
    existingContents = removeEnvAssignment(existingContents, VERCEL_OIDC_TOKEN);
  }

  const localEnvKeys = existingContents
    ? new Set(
        Object.keys(parseDotenv(getUserManagedEnvContents(existingContents)))
      )
    : new Set<string>();

  const contents =
    CONTENTS_PREFIX +
    Object.keys(records)
      .sort()
      .filter(
        key =>
          !VARIABLES_TO_IGNORE.includes(key) &&
          (key === VERCEL_OIDC_TOKEN || !localEnvKeys.has(key))
      )
      .map(key => `${key}="${escapeValue(records[key])}"`)
      .join('\n') +
    '\n';

  const outputContents = preserveExisting
    ? mergeLinkEnvContents(existingContents ?? '', contents)
    : contents;

  await outputFile(fullPath, outputContents, 'utf8');

  if (deltaString) {
    output.print('\n' + deltaString);
  } else if (oldEnv && exists) {
    output.log('No changes found.');
  }

  let isGitIgnoreUpdated = false;
  if (filename === '.env.local') {
    // When the file is `.env.local`, we also add it to `.gitignore`
    // to avoid accidentally committing it to git.
    // We use '.env*' to match the default .gitignore from
    // create-next-app template. See:
    // https://github.com/vercel/next.js/commit/09a385669b3757ef59065138901eb3084d35d418
    const rootPath = link.repoRoot ?? cwd;
    isGitIgnoreUpdated = await addToGitIgnore(rootPath, '.env*');
  }

  output.print('\n');
  printAlignedLabel(
    exists ? 'Updated' : 'Created',
    `${filename} file${isGitIgnoreUpdated ? ' and added it to .gitignore' : ''}`,
    { gutter: '✓' }
  );
}

function mergeLinkEnvContents(existing: string, pulled: string): string {
  const block = `${LINK_ENV_BLOCK_PREFIX}${pulled}${LINK_ENV_BLOCK_SUFFIX}`;
  const blockStart = existing.indexOf(LINK_ENV_BLOCK_PREFIX);

  if (blockStart !== -1) {
    const blockEnd = existing.indexOf(LINK_ENV_BLOCK_SUFFIX, blockStart);
    if (blockEnd !== -1) {
      return (
        existing.slice(0, blockStart) +
        block +
        existing.slice(blockEnd + LINK_ENV_BLOCK_SUFFIX.length)
      );
    }
  }

  const separator =
    existing.length === 0 ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  return `${existing}${separator}${block}`;
}

function getUserManagedEnvContents(existing: string): string {
  const blockStart = existing.indexOf(LINK_ENV_BLOCK_PREFIX);
  if (blockStart === -1) {
    return existing;
  }

  const blockEnd = existing.indexOf(LINK_ENV_BLOCK_SUFFIX, blockStart);
  if (blockEnd === -1) {
    return existing;
  }

  return (
    existing.slice(0, blockStart) +
    existing.slice(blockEnd + LINK_ENV_BLOCK_SUFFIX.length)
  );
}

function removeEnvAssignment(contents: string, key: string): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const assignment = new RegExp(
    `^[\\t ]*(?:export[\\t ]+)?${escapedKey}[\\t ]*=[^\\r\\n]*(?:\\r?\\n|$)`,
    'gm'
  );

  return contents.replace(assignment, '');
}

async function pullEnvRecordsForEnvPull(
  client: Client,
  pullId: string,
  source: EnvRecordsSource,
  options: { target: string; gitBranch?: string }
) {
  try {
    return await pullEnvRecords(client, pullId, source, options);
  } catch (error) {
    if (!isAPIError(error) || error.code !== 'challenge_required') {
      throw error;
    }

    const refreshToken = client.authConfig.refreshToken;
    if (!refreshToken || client.authConfig.tokenSource || !client.stdin.isTTY) {
      throw error;
    }

    output.stopSpinner();
    output.log('Sensitive Environment Variables require fresh authentication.');

    const acrValues = getAcrValuesFromWWWAuthenticate(error.wwwAuthenticate);
    if (!acrValues) {
      throw error;
    }

    const tokens = await performDeviceCodeFlow(client, {
      refreshToken,
      acrValues,
    });
    if (!tokens) {
      throw error;
    }

    client.updateAuthConfig({
      token: tokens.access_token,
      userId: undefined,
      expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
    });
    client.persistAuthConfig();

    output.spinner('Downloading');
    return await pullEnvRecords(client, pullId, source, options);
  }
}

export function getAcrValuesFromWWWAuthenticate(header: string | undefined) {
  if (!header) {
    return;
  }

  const bearerIndex = header.toLowerCase().indexOf('bearer');
  if (bearerIndex === -1) {
    return;
  }

  const bearerChallenge = header.slice(bearerIndex + 'bearer'.length);
  const match = bearerChallenge.match(
    /(?:^|[,\s])acr_values=(?:"((?:\\.|[^"\\])*)"|([^,\s]+))/i
  );

  return match?.[1]?.replace(/\\(.)/g, '$1') ?? match?.[2];
}

function escapeValue(value: string | undefined) {
  return value
    ? value
        .replace(new RegExp('\n', 'g'), '\\n') // combine newlines (unix) into one line
        .replace(new RegExp('\r', 'g'), '\\r') // combine newlines (windows) into one line
    : '';
}
