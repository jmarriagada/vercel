import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { tmpdir } from 'os';
import { spawn, execFile } from 'child_process';
import output from '../../../src/output-manager';
import { executeUpgrade } from '../../../src/util/upgrade';
import { getUpdateCommandInfo } from '../../../src/util/get-update-command';
import pkg from '../../../src/util/pkg';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

// Mock output-manager
vi.mock('../../../src/output-manager', () => ({
  default: {
    log: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    print: vi.fn(),
  },
}));

// Mock get-update-command
vi.mock('../../../src/util/get-update-command', () => ({
  getUpdateCommandInfo: vi
    .fn()
    .mockResolvedValue({ command: 'npm i -g vercel@latest', global: true }),
}));

const spawnMock = vi.mocked(spawn);
const execFileMock = vi.mocked(execFile);
const outputMock = vi.mocked(output);
const getUpdateCommandInfoMock = vi.mocked(getUpdateCommandInfo);

// Makes the post-upgrade `vercel --version` lookup resolve to `version`.
function mockInstalledVersion(version: string) {
  execFileMock.mockImplementation(((
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, res?: { stdout: string; stderr: string }) => void
  ) => {
    const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
    callback(null, { stdout: `${version}\n`, stderr: '' });
    return {} as any;
  }) as any);
}

describe('executeUpgrade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: the post-upgrade version lookup fails, so getInstalledVersion()
    // returns undefined and the generic success message is used.
    execFileMock.mockImplementation(((
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null) => void
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      callback(new Error('command not found'));
      return {} as any;
    }) as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function createMockProcess() {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    return proc;
  }

  // Helper to wait for async operations to complete
  const tick = () => new Promise(resolve => setImmediate(resolve));

  it('should show success message and hide output on successful upgrade', async () => {
    const mockProcess = createMockProcess();
    spawnMock.mockReturnValue(mockProcess as any);

    const exitCodePromise = executeUpgrade();

    // Wait for getUpdateCommand to resolve and spawn to be called
    await tick();

    // Simulate some output
    mockProcess.stdout.emit('data', Buffer.from('Installing packages...'));
    mockProcess.stderr.emit('data', Buffer.from('npm WARN deprecated'));

    // Simulate successful exit
    mockProcess.emit('close', 0);

    const exitCode = await exitCodePromise;

    expect(exitCode).toBe(0);
    expect(outputMock.success).toHaveBeenCalledWith(
      'Vercel CLI has been upgraded successfully!'
    );
    // Output should NOT be printed on success
    expect(outputMock.print).not.toHaveBeenCalled();
  });

  it('should include the target version in the success message when provided', async () => {
    const mockProcess = createMockProcess();
    spawnMock.mockReturnValue(mockProcess as any);

    const exitCodePromise = executeUpgrade('99.9.9');
    await tick();

    mockProcess.emit('close', 0);

    const exitCode = await exitCodePromise;

    expect(exitCode).toBe(0);
    // Detection fails (default mock), so falls back to targetVersion
    expect(outputMock.success).toHaveBeenCalledWith(
      'Vercel CLI has been upgraded to v99.9.9 successfully!'
    );
  });

  it('reports the actual installed version when it differs from the target version', async () => {
    const mockProcess = createMockProcess();
    spawnMock.mockReturnValue(mockProcess as any);
    // After the install, the installed version is different from the target
    // (e.g. the prompt showed a stale 54.2.0 but @latest installed 54.14.0)
    mockInstalledVersion('54.14.0');

    const exitCodePromise = executeUpgrade('54.2.0');
    await tick();

    mockProcess.emit('close', 0);

    const exitCode = await exitCodePromise;

    expect(exitCode).toBe(0);
    // Success message should reflect the actually installed version, not the
    // stale target version that was passed in
    expect(outputMock.success).toHaveBeenCalledWith(
      'Vercel CLI has been upgraded to v54.14.0 successfully!'
    );
  });

  it('reports no upgrade available when the version did not change', async () => {
    const mockProcess = createMockProcess();
    spawnMock.mockReturnValue(mockProcess as any);
    // After the install, the installed version matches the running version.
    mockInstalledVersion(pkg.version);

    const exitCodePromise = executeUpgrade();
    await tick();

    mockProcess.emit('close', 0);

    const exitCode = await exitCodePromise;

    expect(exitCode).toBe(0);
    expect(outputMock.success).not.toHaveBeenCalled();
    expect(outputMock.log).toHaveBeenCalledWith(
      `No upgrade available. Vercel CLI is already on the latest version (v${pkg.version}).`
    );
  });

  it('reports the new version when the install upgraded the CLI', async () => {
    const mockProcess = createMockProcess();
    spawnMock.mockReturnValue(mockProcess as any);
    // After the install, a newer version is present than what is running.
    mockInstalledVersion('999.0.0');

    const exitCodePromise = executeUpgrade();
    await tick();

    mockProcess.emit('close', 0);

    const exitCode = await exitCodePromise;

    expect(exitCode).toBe(0);
    expect(outputMock.success).toHaveBeenCalledWith(
      'Vercel CLI has been upgraded to v999.0.0 successfully!'
    );
  });

  it('should show captured output and error message on failed upgrade', async () => {
    const mockProcess = createMockProcess();
    spawnMock.mockReturnValue(mockProcess as any);

    const exitCodePromise = executeUpgrade();
    await tick();

    // Simulate some output
    mockProcess.stdout.emit('data', Buffer.from('Installing packages...'));
    mockProcess.stderr.emit('data', Buffer.from('npm ERR! code EACCES'));

    // Simulate failed exit
    mockProcess.emit('close', 1);

    const exitCode = await exitCodePromise;

    expect(exitCode).toBe(1);
    expect(outputMock.success).not.toHaveBeenCalled();
    // Output SHOULD be printed on error
    expect(outputMock.print).toHaveBeenCalledWith('Installing packages...');
    expect(outputMock.print).toHaveBeenCalledWith('npm ERR! code EACCES');
    expect(outputMock.error).toHaveBeenCalledWith(
      'Upgrade failed with exit code 1'
    );
    expect(outputMock.log).toHaveBeenCalledWith(
      'You can try running the command manually: npm i -g vercel@latest'
    );
  });

  it('should handle spawn errors', async () => {
    const mockProcess = createMockProcess();
    spawnMock.mockReturnValue(mockProcess as any);

    const exitCodePromise = executeUpgrade();
    await tick();

    // Simulate spawn error
    mockProcess.emit('error', new Error('Command not found'));

    const exitCode = await exitCodePromise;

    expect(exitCode).toBe(1);
    expect(outputMock.error).toHaveBeenCalledWith(
      'Failed to execute upgrade command: Command not found'
    );
    expect(outputMock.log).toHaveBeenCalledWith(
      'You can try running the command manually: npm i -g vercel@latest'
    );
  });

  it('should handle null exit code as error', async () => {
    const mockProcess = createMockProcess();
    spawnMock.mockReturnValue(mockProcess as any);

    const exitCodePromise = executeUpgrade();
    await tick();

    // Simulate close with null exit code (e.g., killed by signal)
    mockProcess.emit('close', null);

    const exitCode = await exitCodePromise;

    expect(exitCode).toBe(1);
    expect(outputMock.error).toHaveBeenCalledWith(
      'Upgrade failed with exit code unknown'
    );
  });

  it('should not print empty stdout/stderr on error', async () => {
    const mockProcess = createMockProcess();
    spawnMock.mockReturnValue(mockProcess as any);

    const exitCodePromise = executeUpgrade();
    await tick();

    // Simulate failed exit with no output
    mockProcess.emit('close', 1);

    const exitCode = await exitCodePromise;

    expect(exitCode).toBe(1);
    // print should not be called for empty output
    expect(outputMock.print).not.toHaveBeenCalled();
    expect(outputMock.error).toHaveBeenCalledWith(
      'Upgrade failed with exit code 1'
    );
  });

  it('should spawn with correct arguments', async () => {
    const mockProcess = createMockProcess();
    spawnMock.mockReturnValue(mockProcess as any);

    const exitCodePromise = executeUpgrade();
    await tick();

    mockProcess.emit('close', 0);
    await exitCodePromise;

    expect(spawnMock).toHaveBeenCalledWith(
      'npm',
      ['i', '-g', 'vercel@latest'],
      {
        cwd: tmpdir(),
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: false,
      }
    );
  });

  it('should spawn a global upgrade from a neutral directory', async () => {
    const mockProcess = createMockProcess();
    spawnMock.mockReturnValue(mockProcess as any);

    const exitCodePromise = executeUpgrade();
    await tick();

    mockProcess.emit('close', 0);
    await exitCodePromise;

    expect(spawnMock).toHaveBeenCalledWith(
      'npm',
      ['i', '-g', 'vercel@latest'],
      expect.objectContaining({ cwd: tmpdir() })
    );
  });

  it('should spawn a local upgrade from the current working directory', async () => {
    getUpdateCommandInfoMock.mockResolvedValueOnce({
      command: 'pnpm i vercel@latest',
      global: false,
    });
    const mockProcess = createMockProcess();
    spawnMock.mockReturnValue(mockProcess as any);

    const exitCodePromise = executeUpgrade();
    await tick();

    mockProcess.emit('close', 0);
    await exitCodePromise;

    expect(spawnMock).toHaveBeenCalledWith(
      'pnpm',
      ['i', 'vercel@latest'],
      expect.objectContaining({ cwd: process.cwd() })
    );
  });

  it('should spawn with native package arguments', async () => {
    getUpdateCommandInfoMock.mockResolvedValueOnce({
      command: 'npm i -g @vercel/vc-native@latest --force',
      global: true,
    });
    const mockProcess = createMockProcess();
    spawnMock.mockReturnValue(mockProcess as any);

    const exitCodePromise = executeUpgrade();
    await tick();

    mockProcess.emit('close', 0);
    await exitCodePromise;

    expect(spawnMock).toHaveBeenCalledWith(
      'npm',
      ['i', '-g', '@vercel/vc-native@latest', '--force'],
      {
        cwd: tmpdir(),
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: false,
      }
    );
  });

  it('should log upgrade start message', async () => {
    const mockProcess = createMockProcess();
    spawnMock.mockReturnValue(mockProcess as any);

    const exitCodePromise = executeUpgrade();
    await tick();

    mockProcess.emit('close', 0);
    await exitCodePromise;

    expect(outputMock.log).toHaveBeenCalledWith('Upgrading Vercel CLI...');
    expect(outputMock.debug).toHaveBeenCalledWith(
      `Executing: npm i -g vercel@latest (cwd: ${tmpdir()})`
    );
  });
});
