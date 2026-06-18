import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';
import {
  isProviderOrg,
  normalizeOrg,
  normalizeSkillSource,
  resolveProductSkill,
  resolveProviderSkill,
} from '../../../../src/util/integration/skill-suggestion';

const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;

function mockSearch(skills: unknown[]) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ skills }),
  });
}

describe('normalizeSkillSource', () => {
  it('converts a skills.sh URL to owner/repo@skill', () => {
    expect(
      normalizeSkillSource(
        'https://skills.sh/neondatabase/agent-skills/neon-postgres'
      )
    ).toBe('neondatabase/agent-skills@neon-postgres');
  });

  it('converts a GitHub SKILL.md URL (skill = folder holding SKILL.md)', () => {
    expect(
      normalizeSkillSource(
        'https://github.com/neondatabase/agent-skills/blob/main/neon-postgres/SKILL.md'
      )
    ).toBe('neondatabase/agent-skills@neon-postgres');
  });

  it('converts a GitHub tree URL pointing at a skill folder', () => {
    expect(
      normalizeSkillSource(
        'https://github.com/neondatabase/agent-skills/tree/main/neon-postgres'
      )
    ).toBe('neondatabase/agent-skills@neon-postgres');
  });

  it('falls back to owner/repo for a bare GitHub repo URL', () => {
    expect(
      normalizeSkillSource('https://github.com/neondatabase/agent-skills')
    ).toBe('neondatabase/agent-skills');
  });

  it('passes through a raw owner/repo@skill id', () => {
    expect(
      normalizeSkillSource('neondatabase/agent-skills@neon-postgres')
    ).toBe('neondatabase/agent-skills@neon-postgres');
  });

  it('returns null for empty / whitespace / undefined', () => {
    expect(normalizeSkillSource('')).toBeNull();
    expect(normalizeSkillSource('   ')).toBeNull();
    expect(normalizeSkillSource(undefined)).toBeNull();
  });

  it('returns null for a non-URL, non-id string and unknown hosts', () => {
    expect(normalizeSkillSource('not-a-valid-source')).toBeNull();
    expect(normalizeSkillSource('https://example.com/foo/bar')).toBeNull();
  });
});

describe('normalizeOrg', () => {
  it('strips common decorations', () => {
    expect(normalizeOrg('neondatabase')).toBe('neon');
    expect(normalizeOrg('getsentry')).toBe('sentry');
    expect(normalizeOrg('sanity-io')).toBe('sanity');
    expect(normalizeOrg('muxinc')).toBe('mux');
    expect(normalizeOrg('statsig-io')).toBe('statsig');
    expect(normalizeOrg('motherduckdb')).toBe('motherduck');
  });

  it('leaves look-alikes intact', () => {
    expect(normalizeOrg('muxuuu')).toBe('muxuuu');
  });
});

describe('isProviderOrg', () => {
  const neon = { slug: 'neon', name: 'Neon' };

  it('matches the provider org through normalization', () => {
    expect(isProviderOrg('neondatabase', neon)).toBe(true);
    expect(isProviderOrg('getsentry', { slug: 'sentry', name: 'Sentry' })).toBe(
      true
    );
  });

  it('rejects look-alike and unrelated orgs', () => {
    expect(isProviderOrg('muxuuu', { slug: 'mux', name: 'Mux' })).toBe(false);
    expect(isProviderOrg('twostraws', { slug: 'aws', name: 'AWS' })).toBe(
      false
    );
  });
});

describe('resolveProviderSkill', () => {
  beforeEach(() => mockFetch.mockReset());

  it('returns the most-installed skill owned by the provider org', async () => {
    mockSearch([
      { id: 'a', skillId: 'x', source: 'twostraws/swiftui', installs: 9999 },
      {
        id: 'b',
        skillId: 'neon-postgres',
        source: 'neondatabase/agent-skills',
        installs: 100,
      },
      {
        id: 'c',
        skillId: 'neon-branches',
        source: 'neondatabase/agent-skills',
        installs: 500,
      },
    ]);
    const id = await resolveProviderSkill(
      { slug: 'neon', name: 'Neon' },
      { name: 'Neon' }
    );
    expect(id).toBe('neondatabase/agent-skills@neon-branches');
  });

  it('returns null when no result is owned by the provider', async () => {
    mockSearch([
      { id: 'a', skillId: 'x', source: 'muxuuu/serenity', installs: 999 },
    ]);
    const id = await resolveProviderSkill(
      { slug: 'mux', name: 'Mux' },
      { name: 'Mux' }
    );
    expect(id).toBeNull();
  });

  it('returns null on a failed request', async () => {
    mockFetch.mockResolvedValue({ ok: false });
    const id = await resolveProviderSkill(
      { slug: 'neon', name: 'Neon' },
      { name: 'Neon' }
    );
    expect(id).toBeNull();
  });

  it('returns null when the response body is not valid JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('bad json');
      },
    });
    const id = await resolveProviderSkill(
      { slug: 'neon', name: 'Neon' },
      { name: 'Neon' }
    );
    expect(id).toBeNull();
  });
});

describe('resolveProductSkill', () => {
  beforeEach(() => mockFetch.mockReset());

  it('uses the declared agentSkillUrl without hitting the registry', async () => {
    const result = await resolveProductSkill(
      { slug: 'neon', name: 'Neon' },
      {
        slug: 'neon',
        name: 'Neon',
        agentSkillUrl:
          'https://skills.sh/neondatabase/agent-skills/neon-postgres',
      }
    );
    expect(result).toEqual({
      id: 'neondatabase/agent-skills@neon-postgres',
      command: 'npx skills add neondatabase/agent-skills@neon-postgres',
      source: 'declared',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('falls back to a registry match when no URL is declared', async () => {
    mockSearch([
      {
        id: 'b',
        skillId: 'neon-postgres',
        source: 'neondatabase/agent-skills',
        installs: 100,
      },
    ]);
    const result = await resolveProductSkill(
      { slug: 'neon', name: 'Neon' },
      { slug: 'neon', name: 'Neon' }
    );
    expect(result).toEqual({
      id: 'neondatabase/agent-skills@neon-postgres',
      command: 'npx skills add neondatabase/agent-skills@neon-postgres',
      source: 'registry',
    });
  });

  it('returns null when there is no declared URL and no confident match', async () => {
    mockSearch([
      { id: 'a', skillId: 'x', source: 'someuser/random', installs: 999 },
    ]);
    const result = await resolveProductSkill(
      { slug: 'assistloop', name: 'AssistLoop' },
      { slug: 'assistloop', name: 'AssistLoop' }
    );
    expect(result).toBeNull();
  });
});
