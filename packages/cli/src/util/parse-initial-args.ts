import { parseArguments } from './get-args';

const initialFlags = {
  '--version': Boolean,
  '-v': '--version',
  '--non-interactive': Boolean,
} as const;

/**
 * Parse the root CLI arguments used for command dispatch and global options.
 *
 * `curl` is a passthrough command, so flags after its command token belong to
 * curl rather than the Vercel CLI. The first pass identifies the command; the
 * second pass stops at `curl` and leaves its remaining arguments untouched.
 */
export function parseInitialArgs(argv: string[]) {
  const parsed = parseArguments(argv, initialFlags, { permissive: true });

  if (parsed.args[2] !== 'curl') {
    return parsed;
  }

  const commandArgs = parseArguments(argv.slice(2), initialFlags, {
    permissive: true,
    stopAtPositional: true,
  });

  return {
    args: [...argv.slice(0, 2), ...commandArgs.args],
    flags: commandArgs.flags,
  };
}
