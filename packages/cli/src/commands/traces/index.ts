import type Client from '../../util/client';
import output from '../../output-manager';
import { parseArguments } from '../../util/get-args';
import getSubcommand from '../../util/get-subcommand';
import { getFlagsSpecification } from '../../util/get-flags-specification';
import { printError } from '../../util/error';
import { help } from '../help';
import { getCommandAliases } from '..';
import { TracesTelemetryClient } from '../../util/telemetry/commands/traces';
import {
  createSubcommand as createSubcommandMetadata,
  getSubcommand as getSubcommandMetadata,
  tracesCommand,
} from './command';
import get from './get';
import { runCurl } from '../curl';

const COMMAND_CONFIG = {
  get: getCommandAliases(getSubcommandMetadata),
  create: getCommandAliases(createSubcommandMetadata),
};

export default async function traces(client: Client): Promise<number> {
  const telemetry = new TracesTelemetryClient({
    opts: {
      store: client.telemetryEventStore,
    },
  });

  let parsedArgs;
  const flagsSpecification = getFlagsSpecification(tracesCommand.options);
  try {
    parsedArgs = parseArguments(client.argv.slice(2), flagsSpecification, {
      permissive: true,
    });
  } catch (err) {
    printError(err);
    return 1;
  }

  const { subcommand, subcommandOriginal } = getSubcommand(
    parsedArgs.args.slice(1),
    COMMAND_CONFIG
  );

  if (parsedArgs.flags['--help']) {
    telemetry.trackCliFlagHelp('traces', subcommandOriginal);
    const subMetadata =
      subcommand === createSubcommandMetadata.name
        ? createSubcommandMetadata
        : subcommand === getSubcommandMetadata.name
          ? getSubcommandMetadata
          : undefined;
    output.print(
      help(subMetadata ?? tracesCommand, {
        parent: subMetadata ? tracesCommand : undefined,
        columns: client.stderr.columns,
      })
    );
    return 2;
  }

  if (subcommand === createSubcommandMetadata.name) {
    // `traces create` is an alias for `vercel curl --trace`. Strip the
    // `traces create` prefix (mirroring parseCurlLikeArgs' leading-token strip)
    // and hand the remaining args to the shared curl runner with the trace flow
    // forced on. Passing `args` explicitly avoids mutating `client.argv` (which
    // is the live `process.argv` in production).
    const userArgs = client.argv.slice(2);
    const withoutCmd =
      userArgs[0] === tracesCommand.name ? userArgs.slice(1) : userArgs;
    const withoutSub =
      withoutCmd[0] === subcommandOriginal ? withoutCmd.slice(1) : withoutCmd;
    return runCurl(client, { forceTrace: true, args: withoutSub });
  }

  return get(client, telemetry);
}
