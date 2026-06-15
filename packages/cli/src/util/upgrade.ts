import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { getUpdateCommandInfo } from './get-update-command';
import pkg from './pkg';
import output from '../output-manager';

const execFileAsync = promisify(execFile);

/**
 * Reads the currently-installed CLI version by invoking the global `--version`
 * fast path.
 *
 * Used after an upgrade to determine the resulting version. This works for both
 * the Node.js CLI and the native binary, since both ship `vercel` and `vc` bins
 * that print the bare semver to stdout — the same detection `vc --version`
 * already relies on.
 *
 * @returns The installed version, or `undefined` if it can't be determined.
 */
async function getInstalledVersion(): Promise<string | undefined> {
  for (const bin of ['vercel', 'vc']) {
    try {
      const { stdout } = await execFileAsync(bin, ['--version'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      const version = stdout.trim();
      if (version) {
        return version;
      }
    } catch {
      // bin not found on PATH; try the next name
    }
  }
  return undefined;
}

/**
 * Executes the upgrade command to update the Vercel CLI.
 * Returns the exit code from the upgrade process.
 *
 * @param targetVersion The version being upgraded to, when the caller already
 * knows it (the update notifier). When omitted (e.g. `vercel upgrade`), the
 * resulting version is detected after the install so we can report when no
 * upgrade was actually available.
 */
export async function executeUpgrade(targetVersion?: string): Promise<number> {
  const { command: updateCommand, global } = await getUpdateCommandInfo();
  const [command, ...args] = updateCommand.split(' ');

  const cwd = global ? tmpdir() : process.cwd();

  // The version currently running, captured before the install overwrites it.
  // This is what `vc --version` reports, for both Node.js and native binary.
  const versionBefore = pkg.version;

  output.log(`Upgrading Vercel CLI...`);
  output.debug(`Executing: ${updateCommand} (cwd: ${cwd})`);

  return new Promise<number>(resolve => {
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];

    const upgradeProcess = spawn(command, args, {
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: false,
    });

    upgradeProcess.stdout?.on('data', (data: Buffer) => {
      stdout.push(Uint8Array.from(data));
    });

    upgradeProcess.stderr?.on('data', (data: Buffer) => {
      stderr.push(Uint8Array.from(data));
    });

    upgradeProcess.on('error', (err: Error) => {
      output.error(`Failed to execute upgrade command: ${err.message}`);
      output.log(`You can try running the command manually: ${updateCommand}`);
      resolve(1);
    });

    upgradeProcess.on('close', (code: number | null) => {
      if (code !== 0) {
        // Show output only on error
        const stdoutStr = Buffer.concat(stdout).toString();
        const stderrStr = Buffer.concat(stderr).toString();
        if (stdoutStr) {
          output.print(stdoutStr);
        }
        if (stderrStr) {
          output.print(stderrStr);
        }
        output.error(`Upgrade failed with exit code ${code ?? 'unknown'}`);
        output.log(
          `You can try running the command manually: ${updateCommand}`
        );
        resolve(code ?? 1);
        return;
      }

      // The caller already knows the target version (update notifier) — there
      // is always a newer version in that flow, so just report it.
      if (targetVersion) {
        output.success(
          `Vercel CLI has been upgraded to v${targetVersion} successfully!`
        );
        resolve(0);
        return;
      }

      // No known target (e.g. `vercel upgrade`). Package managers exit 0 even
      // when nothing changed, so read the now-installed version to report what
      // actually happened, including when no upgrade was available.
      getInstalledVersion().then(versionAfter => {
        if (versionAfter && versionAfter === versionBefore) {
          output.log(
            `No upgrade available. Vercel CLI is already on the latest version (v${versionBefore}).`
          );
        } else if (versionAfter) {
          output.success(
            `Vercel CLI has been upgraded to v${versionAfter} successfully!`
          );
        } else {
          output.success('Vercel CLI has been upgraded successfully!');
        }
        resolve(0);
      });
    });
  });
}
