import { describe, expect, it } from 'vitest';
import { parseInitialArgs } from '../../../src/util/parse-initial-args';

const argv = (...args: string[]) => ['node', 'vc', ...args];

describe('parseInitialArgs', () => {
  it('leaves native curl -d arguments untouched', () => {
    const parsed = parseInitialArgs(
      argv('curl', 'https://example.com', '-d', '{"ok":true}')
    );

    expect(parsed.flags['--debug']).toBeUndefined();
    expect(parsed.args).toEqual([
      'node',
      'vc',
      'curl',
      'https://example.com',
      '-d',
      '{"ok":true}',
    ]);
  });

  it('still recognizes -d as Vercel debug before curl', () => {
    const parsed = parseInitialArgs(argv('-d', 'curl', 'https://example.com'));

    expect(parsed.flags['--debug']).toBe(true);
    expect(parsed.args).toEqual(['node', 'vc', 'curl', 'https://example.com']);
  });

  it('preserves global parsing behavior for other commands', () => {
    const parsed = parseInitialArgs(argv('deploy', '-d'));

    expect(parsed.flags['--debug']).toBe(true);
    expect(parsed.args).toEqual(['node', 'vc', 'deploy']);
  });
});
