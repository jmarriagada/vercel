import { describe, expect, it } from 'vitest';
import type { VerificationFacts } from '../../../../src/commands/domains/verify-acquisition';
import { diagnoseDomain } from '../../../../src/commands/domains/verify-diagnosis';
import { renderHumanOutput } from '../../../../src/commands/domains/verify-human-output';
import { renderStructuredOutput } from '../../../../src/commands/domains/verify-structured-output';

describe('domains verify output adapters', () => {
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
});
