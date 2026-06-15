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
    expect(humanText).toContain('Auto configure');
    expect(humanText).toContain('cname.vercel-dns.com');
    expect(humanText).toContain('Remove the conflicting CAA record');
    expect(diagnosis.exitCode).toBe(1);
  });
});
