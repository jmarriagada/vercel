import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { getUpdateCommandInfo } from './get-update-command';
import {
  getNativeInstallMethod,
  isNativeBinaryInstall,
} from './native-install';
import { executeStandaloneUpgrade } from './native-upgrade';
import pkg from './pkg';
import output from '../output-manager';

const execFileAsync = promisify(execFile);

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
    } catch {}
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
  if (
    isNativeBinaryInstall() &&
    process.platform !== 'win32' &&
    getNativeInstallMethod() === 'standalone'
  ) {
    return executeStandaloneUpgrade(targetVersion);
  }

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

      if (targetVersion) {
        output.success(
          `Vercel CLI has been upgraded to v${targetVersion} successfully!`
        );
        resolve(0);
        return;
      }

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
