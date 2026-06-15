import { describe, expect, it } from 'vitest';
import type { VerificationFacts } from '../../../../src/commands/domains/verify-acquisition';
import { diagnoseDomain } from '../../../../src/commands/domains/verify-diagnosis';
import { renderHumanOutput } from '../../../../src/commands/domains/verify-human-output';
import { renderStructuredOutput } from '../../../../src/commands/domains/verify-structured-output';

describe('domains verify output adapters', () => {
  it('matches DNS option wording to the number of choices', () => {
    const facts: VerificationFacts = {
      domainName: 'example.com',
      contextName: 'my-team',
      teamId: 'team_123',
      config: {
        configuredBy: null,
        misconfigured: true,
        serviceType: 'external',
        nameservers: ['ns1.provider.com', 'ns2.provider.com'],
        cnames: [],
        aValues: ['1.2.3.4'],
        conflicts: [],
        recommendedIPv4: [{ rank: 1, value: ['76.76.21.21'] }],
        recommendedCNAME: [{ rank: 1, value: 'cname.vercel-dns.com' }],
        ipStatus: 'required-change',
      },
      ownership: 'current-scope',
      intendedNameservers: [],
      project: {
        kind: 'attached',
        idOrName: 'my-site',
        label: 'my-site',
        domain: {
          name: 'example.com',
          apexName: 'example.com',
          projectId: 'prj_123',
          verified: true,
        },
        verificationError: null,
      },
    };
    const render = (intendedNameservers: string[]) => {
      const diagnosis = diagnoseDomain(
        { ...facts, intendedNameservers },
        {
          teamsList: 'vercel teams ls',
          verify: () => 'vercel domains verify example.com',
          attachProject: project => `vercel domains add example.com ${project}`,
          openUrl: url => `open '${url}'`,
        }
      );
      const human = renderHumanOutput(diagnosis, '[10ms]');
      return [human.lead.message, ...human.sections].join('\n');
    };

    const singular = render([]);
    const plural = render(['ns1.vercel-dns.com', 'ns2.vercel-dns.com']);

    expect(singular).toContain(
      'Point example.com to Vercel with the following option:'
    );
    expect(singular).not.toContain('one of the following options');
    expect(plural).toContain(
      'Point example.com to Vercel with one of the following options:'
    );
  });

  it('formats the same diagnosis and remediation for humans and scripts', () => {
    const facts: VerificationFacts = {
      domainName: 'www.example.com',
      contextName: 'my-team',
      teamId: 'team_123',
      config: {
        configuredBy: null,
        misconfigured: true,
        serviceType: 'external',
        nameservers: ['alice.ns.cloudflare.com.', 'bob.ns.cloudflare.com.'],
        cnames: [],
        aValues: ['1.2.3.4'],
        conflicts: [
          {
            type: 'CAA',
            name: 'example.com',
            value: '0 issue "otherca.com"',
          },
        ],
        recommendedIPv4: [{ rank: 1, value: ['76.76.21.21'] }],
        recommendedCNAME: [{ rank: 1, value: 'cname.vercel-dns.com' }],
        ipStatus: 'required-change',
      },
      ownership: 'not-found',
      intendedNameservers: [],
      project: {
        kind: 'attached',
        idOrName: 'my-site',
        label: 'my-site',
        domain: {
          name: 'www.example.com',
          apexName: 'example.com',
          projectId: 'prj_123',
          verified: true,
        },
        verificationError: null,
      },
    };
    const diagnosis = diagnoseDomain(facts, {
      teamsList: 'vercel teams ls',
      verify: () => 'vercel domains verify www.example.com',
      attachProject: project => `vercel domains add www.example.com ${project}`,
      openUrl: url => `open '${url}'`,
    });

    const structured = JSON.parse(renderStructuredOutput(diagnosis));
    const human = renderHumanOutput(diagnosis, '[10ms]');
    const humanText = [human.lead.message, ...human.sections].join('\n');

    expect(structured).toMatchObject({
      status: 'action_required',
      reason: 'invalid_configuration',
      domainStatus: 'invalid-configuration',
      configurationStatus: 'invalid-configuration',
      domainConnect: {
        providerId: 'cloudflare.com',
      },
    });
    expect(structured.recommended.records).toContainEqual({
      type: 'CNAME',
      name: 'www',
      value: 'cname.vercel-dns.com',
      disableProxy: true,
    });
    expect(humanText).toContain('Invalid Configuration');
    expect(humanText).toContain(
      'Point www.example.com to Vercel with one of the following options:'
    );
    expect(humanText).toContain('a) Auto configure with Cloudflare');
    expect(humanText).toContain('b) Add a CNAME record');
    expect(humanText).toContain('cname.vercel-dns.com');
    expect(humanText).toContain('2. Remove the conflicting CAA record');
    expect(humanText).toContain('Remove the conflicting CAA record');
    expect(diagnosis.exitCode).toBe(1);
  });

  it('recommends project attachment for an unused owned hostname', () => {
    const facts: VerificationFacts = {
      domainName: 'unused.example.com',
      contextName: 'my-team',
      teamId: 'team_123',
      config: {
        configuredBy: 'http',
        misconfigured: false,
        serviceType: 'zeit.world',
        nameservers: ['ns2.vercel-dns.com', 'ns1.vercel-dns.com'],
        cnames: [],
        aValues: ['64.29.17.65', '216.198.79.1'],
        conflicts: [],
        recommendedIPv4: [{ rank: 1, value: ['76.76.21.21'] }],
        recommendedCNAME: [{ rank: 1, value: 'cname.vercel-dns.com' }],
        ipStatus: 'required-change',
      },
      ownership: 'current-scope',
      intendedNameservers: ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'],
      project: { kind: 'none' },
    };
    const diagnosis = diagnoseDomain(facts, {
      teamsList: 'vercel teams ls',
      verify: () => 'vercel domains verify unused.example.com',
      attachProject: project =>
        `vercel domains add unused.example.com ${project}`,
      openUrl: url => `open '${url}'`,
    });

    const structured = JSON.parse(renderStructuredOutput(diagnosis));
    const human = renderHumanOutput(diagnosis, '[10ms]');
    const humanText = [human.lead.message, ...human.sections].join('\n');

    expect(structured).toMatchObject({
      status: 'ok',
      reason: 'project_attachment_recommended',
      domainStatus: 'project-attachment-recommended',
      configurationStatus: 'project-attachment-recommended',
      ok: true,
      recommended: {
        ipv4: [],
        cname: [],
        records: [],
        nameservers: [],
      },
    });
    expect(humanText).toContain('Not assessed without a project');
    expect(humanText).toContain(
      'To use unused.example.com, attach it to a project'
    );
    expect(humanText).toContain(
      'vercel domains add unused.example.com <project>'
    );
    expect(humanText).not.toContain(
      'No action is needed for an unused hostname'
    );
    expect(humanText).not.toContain('DNS Change Recommended');
    expect(humanText).not.toContain('avoid downtime');
    expect(humanText).not.toContain('Add a CNAME record');
    expect(humanText).not.toContain('cname.vercel-dns.com');
    expect(humanText).not.toContain('Switch to the Vercel nameservers');
    expect(diagnosis.exitCode).toBe(0);
  });

  it('renders remediation steps for a configured domain without a project', () => {
    const domainName = 'example.com';
    const facts: VerificationFacts = {
      domainName,
      contextName: 'my-team',
      teamId: 'team_123',
      config: {
        configuredBy: 'A',
        misconfigured: false,
        serviceType: 'external',
        nameservers: ['ns1.provider.com', 'ns2.provider.com'],
        cnames: [],
        aValues: ['76.76.21.21'],
        conflicts: [],
        recommendedIPv4: [{ rank: 1, value: ['76.76.21.21'] }],
        recommendedCNAME: [{ rank: 1, value: 'cname.vercel-dns.com' }],
        ipStatus: 'no-change',
      },
      ownership: 'not-found',
      intendedNameservers: [],
      project: { kind: 'none' },
    };
    const diagnosis = diagnoseDomain(facts, {
      teamsList: 'vercel teams ls',
      verify: () => `vercel domains verify ${domainName}`,
      attachProject: project => `vercel domains add ${domainName} ${project}`,
      openUrl: url => `open '${url}'`,
    });

    const human = renderHumanOutput(diagnosis, '[10ms]');
    const humanText = [human.lead.message, ...human.sections].join('\n');

    expect(diagnosis.status).toBe('configured-correctly');
    expect(human.lead.kind).toBe('log');
    expect(humanText).toContain('Recommended change');
    expect(humanText).toContain('To use example.com, attach it to a project');
  });

  it('orders project attachment before DNS changes for a new misconfigured domain', () => {
    const domainName = 'example.com';
    const facts: VerificationFacts = {
      domainName,
      contextName: 'my-team',
      teamId: 'team_123',
      config: {
        configuredBy: null,
        misconfigured: true,
        serviceType: 'external',
        nameservers: ['ns1.provider.com', 'ns2.provider.com'],
        cnames: [],
        aValues: ['1.2.3.4'],
        conflicts: [],
        recommendedIPv4: [{ rank: 1, value: ['76.76.21.21'] }],
        recommendedCNAME: [{ rank: 1, value: 'cname.vercel-dns.com' }],
        ipStatus: 'required-change',
      },
      ownership: 'not-found',
      intendedNameservers: [],
      project: { kind: 'none' },
    };
    const diagnosis = diagnoseDomain(facts, {
      teamsList: 'vercel teams ls',
      verify: () => `vercel domains verify ${domainName}`,
      attachProject: project => `vercel domains add ${domainName} ${project}`,
      openUrl: url => `open '${url}'`,
    });

    const structured = JSON.parse(renderStructuredOutput(diagnosis));
    const human = renderHumanOutput(diagnosis, '[10ms]');
    const humanText = [human.lead.message, ...human.sections].join('\n');
    const attachIndex = humanText.indexOf(
      `Attach ${domainName} to the project that should serve it`
    );
    const dnsIndex = humanText.indexOf(
      `Then point ${domainName} to Vercel with the following option:`
    );

    expect(structured).toMatchObject({
      status: 'action_required',
      reason: 'invalid_configuration',
      message:
        'example.com is not attached to a project and has an invalid DNS configuration. Attach it to a project and apply the recommended DNS changes, then retry verification.',
      domainStatus: 'invalid-configuration',
      ok: false,
      project: null,
      next: [
        {
          command: 'vercel domains add example.com <project>',
          when: 'Replace <project> with the project that should serve the domain',
        },
        {
          command: 'vercel domains verify example.com',
          when: 'Re-check after completing the required changes',
        },
      ],
    });
    expect(structured.recommended.records).toEqual([
      {
        type: 'A',
        name: '@',
        value: '76.76.21.21',
      },
    ]);
    expect(attachIndex).toBeGreaterThanOrEqual(0);
    expect(dnsIndex).toBeGreaterThan(attachIndex);
    expect(humanText).toContain('vercel domains add example.com <project>');
    expect(humanText).toContain('A      @  76.76.21.21');
    expect(diagnosis.exitCode).toBe(1);
  });

  it('only asks for the owning scope when the domain is inaccessible', () => {
    const facts: VerificationFacts = {
      domainName: 'unused.example.com',
      contextName: 'my-team',
      teamId: 'team_123',
      config: {
        configuredBy: 'http',
        misconfigured: false,
        serviceType: 'zeit.world',
        nameservers: ['ns2.vercel-dns.com', 'ns1.vercel-dns.com'],
        cnames: [],
        aValues: ['64.29.17.1', '216.198.79.1'],
        conflicts: [],
        recommendedIPv4: [{ rank: 1, value: ['76.76.21.21'] }],
        recommendedCNAME: [{ rank: 1, value: 'cname.vercel-dns.com' }],
        ipStatus: 'required-change',
      },
      ownership: 'other-scope',
      intendedNameservers: [],
      project: { kind: 'none' },
    };
    const diagnosis = diagnoseDomain(facts, {
      teamsList: 'vercel teams ls',
      verify: scope =>
        `vercel domains verify unused.example.com --scope ${scope}`,
      attachProject: project =>
        `vercel domains add unused.example.com ${project}`,
      openUrl: url => `open '${url}'`,
    });

    const structured = JSON.parse(renderStructuredOutput(diagnosis));
    const human = renderHumanOutput(diagnosis, '[10ms]');
    const humanText = [human.lead.message, ...human.sections].join('\n');

    expect(structured).toMatchObject({
      status: 'action_required',
      reason: 'scope_not_accessible',
      domainStatus: 'scope-resolution-required',
      configurationStatus: 'scope-resolution-required',
      ok: false,
      issues: [
        {
          domainStatus: 'scope-resolution-required',
          reason: 'scope_not_accessible',
        },
      ],
      recommended: {
        ipv4: [],
        cname: [],
        records: [],
        nameservers: [],
      },
      conflicts: [],
    });
    expect(humanText).toContain('Not assessed in this scope');
    expect(humanText).toContain('Not accessible under');
    expect(humanText).toContain('--scope <team>');
    expect(humanText).toContain('Currently resolves to');
    expect(humanText).toContain('Nameservers');
    expect(humanText).not.toContain('DNS Change Required');
    expect(humanText).not.toContain('avoid downtime');
    expect(humanText).not.toContain('Add a CNAME record');
    expect(diagnosis.exitCode).toBe(1);
  });

  it('reports a Vercel-managed project domain as healthy', () => {
    const domainName = 'my-site.vercel.app';
    const facts: VerificationFacts = {
      domainName,
      contextName: 'my-team',
      teamId: 'team_123',
      config: {
        configuredBy: 'A',
        misconfigured: false,
        serviceType: 'zeit.world',
        nameservers: ['ns1.vercel-dns-3.com', 'ns2.vercel-dns-3.com'],
        cnames: [],
        aValues: ['64.29.17.1', '216.198.79.1'],
        conflicts: [],
        recommendedIPv4: [{ rank: 1, value: ['216.150.1.1'] }],
        recommendedCNAME: [
          { rank: 1, value: 'project-specific.vercel-dns-017.com.' },
        ],
        ipStatus: 'optional-change',
      },
      ownership: 'platform-managed',
      intendedNameservers: [],
      project: {
        kind: 'attached',
        idOrName: 'my-site',
        label: 'my-site',
        domain: {
          name: domainName,
          apexName: 'vercel.app',
          projectId: 'prj_123',
          verified: true,
        },
        verificationError: null,
      },
    };
    const diagnosis = diagnoseDomain(facts, {
      teamsList: 'vercel teams ls',
      verify: () => `vercel domains verify ${domainName}`,
      attachProject: project => `vercel domains add ${domainName} ${project}`,
      openUrl: url => `open '${url}'`,
    });

    const structured = JSON.parse(renderStructuredOutput(diagnosis));
    const human = renderHumanOutput(diagnosis, '[10ms]');
    const humanText = [human.lead.message, ...human.sections].join('\n');

    expect(structured).toMatchObject({
      status: 'ok',
      reason: 'configured_correctly',
      domainStatus: 'configured-correctly',
      configurationStatus: 'configured-correctly',
      domainOwnership: 'platform-managed',
      recommended: {
        ipv4: [],
        cname: [],
        records: [],
        nameservers: [],
      },
    });
    expect(human.lead.kind).toBe('success');
    expect(human.sections).toEqual([]);
    expect(humanText).toContain('Valid Configuration');
    expect(humanText).toContain('verified for project');
    expect(humanText).toContain('my-site');
    expect(humanText).not.toContain('DNS Change Recommended');
    expect(humanText).not.toContain('Ownership');
    expect(humanText).not.toContain('CNAME');
  });
});
