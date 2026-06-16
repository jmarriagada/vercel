import type { Integration, IntegrationProduct } from './types';

export type SkillSuggestion =
  | { kind: 'add'; id: string; command: string }
  | { kind: 'find'; query: string; command: string };

/**
 * Build a skills.sh suggestion to print after a product is provisioned.
 *
 * - If the product declares an agent skill (`agentSkillUrl`), normalize it to a
 *   skills.sh `owner/repo@skill` id and return a ready-to-run `npx skills add`.
 * - Otherwise fall back to `npx skills find "<provider>"` (skills.sh is the
 *   default discovery path); the agent installs the result published by the
 *   provider's own org, or nothing if none matches.
 */
export function getSkillSuggestion(
  integration: Pick<Integration, 'slug' | 'name'>,
  product: Pick<IntegrationProduct, 'slug' | 'name' | 'agentSkillUrl'>
): SkillSuggestion {
  const id = normalizeSkillSource(product.agentSkillUrl);
  if (id) {
    return { kind: 'add', id, command: `npx skills add ${id}` };
  }

  const query = buildFindQuery(integration, product);
  return {
    kind: 'find',
    query,
    command: `npx skills find ${JSON.stringify(query)}`,
  };
}

function buildFindQuery(
  integration: Pick<Integration, 'slug' | 'name'>,
  product: Pick<IntegrationProduct, 'name'>
): string {
  const terms = [integration.name, product.name].filter(
    (term, index, all): term is string =>
      Boolean(term) && all.indexOf(term) === index
  );
  return terms.join(' ') || integration.slug;
}

/**
 * Normalize a publisher-supplied skill reference into the `owner/repo@skill`
 * form that `npx skills add` installs precisely. Accepts:
 *   - skills.sh URL:   https://skills.sh/<owner>/<repo>/<skill>
 *   - GitHub URL:      https://github.com/<owner>/<repo>/(blob|tree)/<branch>/.../<skill>[/SKILL.md]
 *   - a raw id already in `owner/repo` or `owner/repo@skill` form
 *
 * Returns null when there is nothing usable. A GitHub repo URL with no skill in
 * the path resolves to `owner/repo` (installs the repo's lone skill, or all of
 * them) — that is the publisher's choice, not an error.
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
