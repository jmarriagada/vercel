import { describe, expect, it, vi } from 'vitest';
import { client } from '../../../mocks/client';
import deploy from '../../../../src/commands/deploy';
import { setupUnitFixture } from '../../../helpers/setup-unit-fixture';
import { defaultProject, useProject } from '../../../mocks/project';
import { useTeams } from '../../../mocks/team';
import { useUser } from '../../../mocks/user';
import output from '../../../../src/output-manager';
import * as createDeployModule from '../../../../src/util/deploy/create-deploy';
import { BuildsRateLimited } from '../../../../src/util/errors-ts';

// When a deploy hits the daily builds limit (a `builds_rate_limited` 429), the
// CLI should surface the error AND a note telling the user how to raise the
// limit. The note previously never fired because the error was built with
// `Object.create`, which `isAPIError` rejects, so it was never converted into a
// `BuildsRateLimited`.
describe('deploy — builds_rate_limited upgrade note', () => {
  it('surfaces the error and a `buy pro` note on a builds_rate_limited 429', async () => {
    useUser();
    useTeams('team_dummy');
    useProject({ ...defaultProject, name: 'static', id: 'static' });

    // The real production trigger: API returns builds_rate_limited on create.
    client.scenario.post('/v13/deployments', (_req, res) => {
      res.status(429).json({
        error: {
          code: 'builds_rate_limited',
          message: 'You have reached your daily builds limit.',
        },
      });
    });

    const noteSpy = vi.spyOn(output, 'note');
    const errorSpy = vi.spyOn(output, 'error');

    client.cwd = setupUnitFixture('commands/deploy/static');
    client.setArgv('deploy');
    const exitCode = await deploy(client);

    expect(exitCode).toBe(1);

    // The error reaches the user with the server message (and no `(429)` suffix).
    const errorMessages = errorSpy.mock.calls.map(c => String(c[0]));
    expect(
      errorMessages.some(m =>
        m.includes('You have reached your daily builds limit.')
      )
    ).toBe(true);
    expect(errorMessages.some(m => m.includes('(429)'))).toBe(false);

    // The upgrade hint fires and points at the working `buy pro` command, not
    // the CLI self-updater (`vercel upgrade`).
    const noteMessages = noteSpy.mock.calls.map(c => String(c[0]));
    expect(noteMessages.some(m => m.includes('buy pro'))).toBe(true);
    expect(
      noteMessages.some(m => m.includes('to increase your builds limit'))
    ).toBe(true);
  });

  it('prints the `buy pro` note when createDeploy throws BuildsRateLimited', async () => {
    useUser();
    useTeams('team_dummy');
    useProject({ ...defaultProject, name: 'static', id: 'static' });

    // Force the exact CLI error class to be thrown from createDeploy.
    vi.spyOn(createDeployModule, 'default').mockRejectedValue(
      new BuildsRateLimited('You have reached your daily builds limit.')
    );

    const noteSpy = vi.spyOn(output, 'note');

    client.cwd = setupUnitFixture('commands/deploy/static');
    client.setArgv('deploy');
    const exitCode = await deploy(client);

    expect(exitCode).toBe(1);
    const noteMessages = noteSpy.mock.calls.map(c => String(c[0]));
    expect(noteMessages.some(m => m.includes('buy pro'))).toBe(true);
  });
});
