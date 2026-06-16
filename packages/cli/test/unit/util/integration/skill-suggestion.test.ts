import { describe, expect, it } from 'vitest';
import {
  getSkillSuggestion,
  normalizeSkillSource,
} from '../../../../src/util/integration/skill-suggestion';

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

  it('handles a nested SKILL.md path', () => {
    expect(
      normalizeSkillSource(
        'https://github.com/acme/repo/blob/main/skills/my-skill/SKILL.md'
      )
    ).toBe('acme/repo@my-skill');
  });

  it('falls back to owner/repo for a bare GitHub repo URL', () => {
    expect(
      normalizeSkillSource('https://github.com/neondatabase/agent-skills')
    ).toBe('neondatabase/agent-skills');
  });

  it('falls back to owner/repo for a skills.sh URL without a skill', () => {
    expect(
      normalizeSkillSource('https://skills.sh/neondatabase/agent-skills')
    ).toBe('neondatabase/agent-skills');
  });

  it('passes through a raw owner/repo@skill id', () => {
    expect(
      normalizeSkillSource('neondatabase/agent-skills@neon-postgres')
    ).toBe('neondatabase/agent-skills@neon-postgres');
  });

  it('upgrades http to https-style parsing (still resolves the id)', () => {
    expect(normalizeSkillSource('http://skills.sh/acme/repo/my-skill')).toBe(
      'acme/repo@my-skill'
    );
  });

  it('returns null for empty / whitespace / undefined', () => {
    expect(normalizeSkillSource('')).toBeNull();
    expect(normalizeSkillSource('   ')).toBeNull();
    expect(normalizeSkillSource(undefined)).toBeNull();
  });

  it('returns null for a non-URL, non-id string', () => {
    expect(normalizeSkillSource('not-a-valid-source')).toBeNull();
  });

  it('returns null for an unknown host', () => {
    expect(normalizeSkillSource('https://example.com/foo/bar')).toBeNull();
  });
});

describe('getSkillSuggestion', () => {
  const integration = { slug: 'neon', name: 'Neon' };

  it('returns an add suggestion when the product has agentSkillUrl', () => {
    const result = getSkillSuggestion(integration, {
      slug: 'neon',
      name: 'Neon',
      agentSkillUrl:
        'https://skills.sh/neondatabase/agent-skills/neon-postgres',
    });
    expect(result).toEqual({
      kind: 'add',
      id: 'neondatabase/agent-skills@neon-postgres',
      command: 'npx skills add neondatabase/agent-skills@neon-postgres',
    });
  });

  it('falls back to a find suggestion when agentSkillUrl is missing', () => {
    const result = getSkillSuggestion(integration, {
      slug: 'neon',
      name: 'Neon',
    });
    expect(result).toEqual({
      kind: 'find',
      query: 'Neon',
      command: 'npx skills find "Neon"',
    });
  });

  it('falls back to find when agentSkillUrl is empty/whitespace', () => {
    const result = getSkillSuggestion(integration, {
      slug: 'neon',
      name: 'Neon',
      agentSkillUrl: '   ',
    });
    expect(result.kind).toBe('find');
  });

  it('falls back to find when agentSkillUrl is unparseable', () => {
    const result = getSkillSuggestion(integration, {
      slug: 'neon',
      name: 'Neon',
      agentSkillUrl: 'https://example.com/docs',
    });
    expect(result.kind).toBe('find');
  });

  it('combines distinct integration + product names in the find query', () => {
    const result = getSkillSuggestion(
      { slug: 'aws', name: 'AWS' },
      { slug: 'aws/opensearch', name: 'Amazon OpenSearch Serverless' }
    );
    expect(result).toEqual({
      kind: 'find',
      query: 'AWS Amazon OpenSearch Serverless',
      command: 'npx skills find "AWS Amazon OpenSearch Serverless"',
    });
  });

  it('dedupes identical integration and product names in the find query', () => {
    const result = getSkillSuggestion(integration, {
      slug: 'neon',
      name: 'Neon',
    });
    expect(result.kind === 'find' && result.query).toBe('Neon');
  });
});
