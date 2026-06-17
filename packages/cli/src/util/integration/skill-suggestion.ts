import execa from 'execa';
import fetch from 'node-fetch';
import output from '../../output-manager';
import type { Integration, IntegrationProduct } from './types';

const SEARCH_ENDPOINT = 'https://skills.sh/api/search';
const SEARCH_TIMEOUT_MS = 3000;
const INSTALL_TIMEOUT_MS = 120000;

export interface ResolvedSkill {
  /** Canonical `owner/repo@skill` id passed to `npx skills add`. */
  id: string;
  /** Ready-to-run install command. */
  command: string;
  /** Where the id came from: a publisher-declared link, or skills.sh lookup. */
  source: 'declared' | 'registry';
}

interface RegistrySkill {
  id: string;
  skillId: string;
  source: string;
  installs?: number;
}

/**
 * Resolve the Claude Code skill for a freshly-provisioned product.
 *
 * 1. If the publisher declared one (`agentSkillUrl`), normalize it to an id.
 * 2. Otherwise look it up on skills.sh and keep the result only when it is
 *    confidently published by the provider's own org.
 *
 * Returns null when nothing usable is found — the caller stays silent rather
 * than suggesting a skill the provider didn't author.
 */
export async function resolveProductSkill(
  integration: Pick<Integration, 'slug' | 'name'>,
  product: Pick<IntegrationProduct, 'slug' | 'name' | 'agentSkillUrl'>
): Promise<ResolvedSkill | null> {
  const declared = normalizeSkillSource(product.agentSkillUrl);
  if (declared) {
    return {
      id: declared,
      command: `npx skills add ${declared}`,
      source: 'declared',
    };
  }

  const found = await resolveProviderSkill(integration, product);
  if (found) {
    return {
      id: found,
      command: `npx skills add ${found}`,
      source: 'registry',
    };
  }

  return null;
}

/** Run `npx skills add <id>`; returns true on success. Never throws. */
export async function installSkill(id: string): Promise<boolean> {
  try {
    await execa('npx', ['-y', 'skills', 'add', id], {
      timeout: INSTALL_TIMEOUT_MS,
      stdio: 'pipe',
    });
    return true;
  } catch (err) {
    output.debug(`Skill auto-install failed: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Look up a product's skill on skills.sh and return the `owner/repo@skill` id
 * only when a result is confidently owned by the provider's org. Returns null
 * on any error, timeout, or no confident match (fail silent).
 */
export async function resolveProviderSkill(
  integration: Pick<Integration, 'slug' | 'name'>,
  product: Pick<IntegrationProduct, 'name'>
): Promise<string | null> {
  const terms = [integration.name, product.name].filter(
    (term, index, all): term is string =>
      Boolean(term) && all.indexOf(term) === index
  );
  const query = terms.join(' ') || integration.slug;

  let skills: RegistrySkill[];
  try {
    const res = await fetch(
      `${SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}`,
      { timeout: SEARCH_TIMEOUT_MS }
    );
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { skills?: RegistrySkill[] };
    skills = body.skills ?? [];
  } catch (err) {
    output.debug(`skills.sh lookup failed: ${(err as Error).message}`);
    return null;
  }

  const owned = skills
    .filter(
      skill =>
        skill.source && isProviderOrg(skill.source.split('/')[0], integration)
    )
    .sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0));

  const best = owned[0];
  return best ? `${best.source}@${best.skillId}` : null;
}

/**
 * True when a skills.sh owner org confidently belongs to the provider. Uses a
 * normalize-then-exact match (not substring) so `neondatabase` matches `neon`
 * and `getsentry` matches `sentry`, while look-alikes like `muxuuu` (vs `mux`)
 * are rejected.
 */
export function isProviderOrg(
  owner: string,
  integration: { slug: string; name: string }
): boolean {
  const normalized = normalizeOrg(owner);
  if (normalized.length < 3) {
    return false;
  }
  const targets = new Set([
    normalizeOrg(integration.slug),
    normalizeOrg(integration.name),
  ]);
  return targets.has(normalized);
}

/** Strip common org-name decorations (neondatabase→neon, getsentry→sentry). */
export function normalizeOrg(value: string): string {
  let s = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  s = s.replace(/^get/, '');
  const suffixes = ['database', 'cloud', 'labs', 'inc', 'hq', 'io', 'ai', 'db'];
  for (const suffix of suffixes) {
    if (s.endsWith(suffix) && s.length > suffix.length + 2) {
      s = s.slice(0, -suffix.length);
      break;
    }
  }
  return s;
}

/**
 * Normalize a publisher-supplied skill reference into the `owner/repo@skill`
 * form that `npx skills add` installs precisely. Accepts:
 *   - skills.sh URL:   https://skills.sh/<owner>/<repo>/<skill>
 *   - GitHub URL:      https://github.com/<owner>/<repo>/(blob|tree)/<branch>/.../<skill>[/SKILL.md]
 *   - a raw id already in `owner/repo` or `owner/repo@skill` form
 *
 * Returns null when there is nothing usable.
 */
export function normalizeSkillSource(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) {
    return null;
  }

  // Already an id (not a URL): owner/repo or owner/repo@skill
  if (!/^https?:\/\//i.test(value)) {
    return /^[^/\s]+\/[^/\s]+/.test(value) ? value : null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');
  const segments = url.pathname.split('/').filter(Boolean);

  if (host === 'skills.sh') {
    const [owner, repo, skill] = segments;
    if (!owner || !repo) {
      return null;
    }
    return skill ? `${owner}/${repo}@${skill}` : `${owner}/${repo}`;
  }

  if (host === 'github.com') {
    const [owner, repo, kind, , ...rest] = segments;
    if (!owner || !repo) {
      return null;
    }
    if (kind === 'blob' || kind === 'tree') {
      // The skill name is the directory that contains SKILL.md (skills.sh
      // requires the folder name to equal the skill name).
      const parts = rest.filter(part => part.toLowerCase() !== 'skill.md');
      const skill = parts[parts.length - 1];
      return skill ? `${owner}/${repo}@${skill}` : `${owner}/${repo}`;
    }
    return `${owner}/${repo}`;
  }

  return null;
}
