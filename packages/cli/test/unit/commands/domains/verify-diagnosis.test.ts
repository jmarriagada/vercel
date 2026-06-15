import { describe, expect, it } from 'vitest';
import type { DomainConfigV6 } from '../../../../src/util/domains/get-domain-config-v6';
import type { ProjectDomain } from '../../../../src/util/projects/get-project-domain';
import type {
  ProjectStatus,
  VerificationFacts,
} from '../../../../src/commands/domains/verify-acquisition';
import {
  diagnoseDomain,
  type DomainDiagnosisCommands,
} from '../../../../src/commands/domains/verify-diagnosis';

const DOMAIN = 'www.example.com';

function domainConfig(overrides: Partial<DomainConfigV6> = {}): DomainConfigV6 {
  return {
    configuredBy: 'A',
    misconfigured: false,
    serviceType: 'external',
    nameservers: ['ns1.provider.com', 'ns2.provider.com'],
    cnames: [],
    aValues: ['76.76.21.21'],
    conflicts: [],
    acceptedChallenges: ['http-01', 'dns-01'],
    recommendedIPv4: [{ rank: 1, value: ['76.76.21.21'] }],
    recommendedCNAME: [{ rank: 1, value: 'cname.vercel-dns.com' }],
    ipStatus: 'no-change',
    ...overrides,
  };
}

function attachedProject(
  overrides: Partial<ProjectDomain> = {}
): ProjectStatus {
  return {
    kind: 'attached',
    idOrName: 'my-site',
    label: 'my-site',
    domain: {
      name: DOMAIN,
      apexName: 'example.com',
      projectId: 'prj_123',
      verified: true,
      ...overrides,
    },
    verificationError: null,
  };
}

function verificationFacts(
  overrides: Partial<Omit<VerificationFacts, 'config' | 'project'>> & {
    config?: Partial<DomainConfigV6>;
    project?: ProjectStatus;
  } = {}
): VerificationFacts {
  const { config, project, ...facts } = overrides;
  return {
    domainName: DOMAIN,
    contextName: 'my-team',
    teamId: undefined,
    config: domainConfig(config),
    ownership: 'not-found',
    intendedNameservers: [],
    project: project ?? { kind: 'none' },
    ...facts,
  };
}

function commandsFor(domainName: string): DomainDiagnosisCommands {
  return {
    teamsList: 'vercel teams ls',
    verify: scopeOverride =>
      `vercel domains verify ${domainName}${
        scopeOverride ? ` --scope ${scopeOverride}` : ''
      }`,
    attachProject: projectIdOrName =>
      `vercel domains add ${domainName} ${projectIdOrName}`,
    openUrl: url => `open '${url}'`,
  };
}

function diagnose(facts: VerificationFacts) {
  return diagnoseDomain(facts, commandsFor(facts.domainName));
}

describe('domains verify diagnosis', () => {
  it.each([
    {
      name: 'healthy configuration',
      facts: verificationFacts(),
      status: 'configured-correctly',
      configurationStatus: 'configured-correctly',
      exitCode: 0,
      issues: [],
    },
    {
      name: 'recommended DNS change',
      facts: verificationFacts({
        config: { ipStatus: 'optional-change' },
      }),
      status: 'dns-change-recommended',
      configurationStatus: 'dns-change-recommended',
      exitCode: 0,
      issues: ['dns-change-recommended'],
    },
    {
      name: 'required DNS change',
      facts: verificationFacts({
        config: { ipStatus: 'required-change' },
      }),
      status: 'dns-change-required',
      configurationStatus: 'dns-change-required',
      exitCode: 1,
      issues: ['dns-change-required'],
    },
    {
      name: 'invalid configuration',
      facts: verificationFacts({
        config: { configuredBy: null, misconfigured: true },
      }),
      status: 'invalid-configuration',
      configurationStatus: 'invalid-configuration',
      exitCode: 1,
      issues: ['invalid-configuration'],
    },
    {
      name: 'DNSSEC before invalid configuration',
      facts: verificationFacts({
        config: {
          configuredBy: null,
          misconfigured: true,
          serviceType: 'zeit.world',
          dnssecEnabled: true,
        },
      }),
      status: 'dnssec-needs-to-be-disabled',
      configurationStatus: 'dnssec-needs-to-be-disabled',
      exitCode: 1,
      issues: ['dnssec-needs-to-be-disabled'],
    },
    {
      name: 'project verification',
      facts: verificationFacts({
        project: attachedProject({ verified: false }),
      }),
      status: 'verification-needed',
      configurationStatus: 'configured-correctly',
      exitCode: 1,
      issues: ['verification-needed'],
    },
    {
      name: 'missing project before invalid configuration',
      facts: verificationFacts({
        config: { configuredBy: null, misconfigured: true },
        project: { kind: 'missing', idOrName: 'my-site' },
      }),
      status: 'project-domain-missing',
      configurationStatus: 'invalid-configuration',
      exitCode: 1,
      issues: ['project-domain-missing', 'invalid-configuration'],
    },
    {
      name: 'invalid configuration before project verification',
      facts: verificationFacts({
        config: { configuredBy: null, misconfigured: true },
        project: attachedProject({ verified: false }),
      }),
      status: 'invalid-configuration',
      configurationStatus: 'invalid-configuration',
      exitCode: 1,
      issues: ['invalid-configuration', 'verification-needed'],
    },
  ])('classifies $name', ({
    facts,
    status,
    configurationStatus,
    exitCode,
    issues,
  }) => {
    const diagnosis = diagnose(facts);

    expect(diagnosis).toMatchObject({
      status,
      configurationStatus,
      exitCode,
    });
    expect(diagnosis.issues.map(issue => issue.domainStatus)).toEqual(issues);
  });

  it('builds Cloudflare remediation once for a subdomain', () => {
    const facts = verificationFacts({
      teamId: 'team_123',
      config: {
        configuredBy: null,
        misconfigured: true,
        ipStatus: 'required-change',
        nameservers: ['alice.ns.cloudflare.com.', 'bob.ns.cloudflare.com.'],
      },
      project: attachedProject(),
    });

    const diagnosis = diagnose(facts);

    expect(diagnosis.recommendedDnsRecords).toEqual([
      {
        type: 'CNAME',
        name: 'www',
        value: 'cname.vercel-dns.com',
        disableProxy: true,
      },
    ]);
    expect(diagnosis.remediation.domainConnect).toEqual({
      protocol: 'domain-connect',
      providerId: 'cloudflare.com',
      providerName: 'Cloudflare',
      applyUrl:
        `https://vercel.com/api/v9/projects/prj_123/domains/${DOMAIN}` +
        '/domain-connect/apply?teamId=team_123',
    });
    expect(diagnosis.next).toEqual([
      expect.objectContaining({ command: expect.stringContaining("open '") }),
      expect.objectContaining({
        command: `vercel domains verify ${DOMAIN}`,
      }),
    ]);
  });

  it('prefers a proxy-disabled CNAME for a Cloudflare apex domain', () => {
    const domainName = 'example.com';
    const facts = verificationFacts({
      domainName,
      config: {
        configuredBy: null,
        misconfigured: true,
        ipStatus: 'required-change',
        nameservers: ['alice.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
      },
      project: attachedProject({
        name: domainName,
        apexName: domainName,
      }),
    });

    const diagnosis = diagnose(facts);

    expect(diagnosis.recommendedDnsRecords).toEqual([
      {
        type: 'CNAME',
        name: '@',
        value: 'cname.vercel-dns.com',
        disableProxy: true,
      },
    ]);
  });

  it('uses wildcard record names without offering Domain Connect', () => {
    const domainName = '*.example.com';
    const facts = verificationFacts({
      domainName,
      config: {
        configuredBy: null,
        misconfigured: true,
        ipStatus: 'required-change',
        nameservers: ['alice.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
      },
      project: attachedProject({
        name: domainName,
      }),
    });

    const diagnosis = diagnose(facts);

    expect(diagnosis.recommendedDnsRecords).toContainEqual(
      expect.objectContaining({ name: '*' })
    );
    expect(diagnosis.remediation.domainConnect).toBeNull();
  });

  it('does not treat mixed nameservers as Cloudflare DNS', () => {
    const facts = verificationFacts({
      config: {
        configuredBy: null,
        misconfigured: true,
        ipStatus: 'required-change',
        nameservers: ['alice.ns.cloudflare.com', 'ns1.another-provider.com'],
      },
      project: attachedProject(),
    });

    const diagnosis = diagnose(facts);

    expect(diagnosis.remediation.domainConnect).toBeNull();
    expect(diagnosis.recommendedDnsRecords).not.toContainEqual(
      expect.objectContaining({ disableProxy: true })
    );
  });

  it('recommends project attachment for an owned hostname without a project', () => {
    const domainName = 'unused.example.com';
    const facts = verificationFacts({
      domainName,
      ownership: 'current-scope',
      intendedNameservers: ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'],
      config: {
        configuredBy: 'http',
        serviceType: 'zeit.world',
        nameservers: ['ns2.vercel-dns.com', 'ns1.vercel-dns.com'],
        aValues: ['64.29.17.65', '216.198.79.1'],
        ipStatus: 'required-change',
      },
    });

    const diagnosis = diagnose(facts);

    expect(diagnosis).toMatchObject({
      status: 'project-attachment-recommended',
      configurationStatus: 'project-attachment-recommended',
      exitCode: 0,
      details: {
        reason: 'project_attachment_recommended',
      },
      remediation: {
        pointing: null,
        attachProject: {
          project: '<project>',
          command: `vercel domains add ${domainName} <project>`,
        },
      },
    });
    expect(diagnosis.recommendedDnsRecords).toEqual([]);
    expect(diagnosis.next).toEqual([
      {
        command: `vercel domains add ${domainName} <project>`,
        when: 'Replace <project> with the project that should serve the domain',
      },
    ]);
  });

  it('ignores infrastructure migrations for a Vercel-managed project domain', () => {
    const domainName = 'my-site.vercel.app';
    const facts = verificationFacts({
      domainName,
      ownership: 'platform-managed',
      config: {
        configuredBy: 'A',
        serviceType: 'zeit.world',
        nameservers: ['ns1.vercel-dns-3.com', 'ns2.vercel-dns-3.com'],
        aValues: ['64.29.17.1', '216.198.79.1'],
        recommendedCNAME: [
          { rank: 1, value: 'project-specific.vercel-dns-017.com.' },
        ],
        ipStatus: 'optional-change',
      },
      project: attachedProject({
        name: domainName,
        apexName: 'vercel.app',
      }),
    });

    const diagnosis = diagnose(facts);

    expect(diagnosis).toMatchObject({
      status: 'configured-correctly',
      configurationStatus: 'configured-correctly',
      exitCode: 0,
      details: {
        reason: 'configured_correctly',
      },
      remediation: {
        pointing: null,
      },
      next: [],
    });
    expect(diagnosis.recommendedDnsRecords).toEqual([]);
  });

  it('defers DNS diagnosis until the domain is checked in its owning scope', () => {
    const domainName = 'unused.example.com';
    const facts = verificationFacts({
      domainName,
      ownership: 'other-scope',
      config: {
        configuredBy: 'http',
        serviceType: 'zeit.world',
        nameservers: ['ns2.vercel-dns.com', 'ns1.vercel-dns.com'],
        aValues: ['64.29.17.1', '216.198.79.1'],
        ipStatus: 'required-change',
      },
    });

    const diagnosis = diagnose(facts);

    expect(diagnosis).toMatchObject({
      status: 'scope-resolution-required',
      configurationStatus: 'scope-resolution-required',
      exitCode: 1,
      details: {
        reason: 'scope_not_accessible',
        userActionRequired: true,
      },
      remediation: {
        domainConnect: null,
        pointing: null,
        disableDnssec: false,
        conflicts: [],
        verification: null,
        attachProject: null,
      },
    });
    expect(diagnosis.issues.map(issue => issue.domainStatus)).toEqual([
      'scope-resolution-required',
    ]);
    expect(diagnosis.recommendedDnsRecords).toEqual([]);
  });

  it('resolves scope before project mutations', () => {
    const facts = verificationFacts({
      ownership: 'other-scope',
      project: { kind: 'missing', idOrName: 'other-site' },
    });

    const diagnosis = diagnose(facts);

    expect(diagnosis.next).toEqual([
      {
        command: 'vercel teams ls',
        when: 'List teams to find the scope that owns the domain',
      },
      {
        command: `vercel domains verify ${DOMAIN} --scope <team>`,
        when: 'Replace <team> with the owning team and retry',
      },
    ]);
    expect(diagnosis.remediation.attachProject).toBeNull();
  });

  it('collects conflicts, nameserver alternatives, and verification facts', () => {
    const facts = verificationFacts({
      config: {
        configuredBy: null,
        misconfigured: true,
        conflicts: [
          {
            type: 'CAA',
            name: 'example.com',
            value: '0 issue "otherca.com"',
          },
        ],
      },
      intendedNameservers: ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'],
      project: attachedProject({
        verified: false,
        verification: [
          {
            type: 'TXT',
            domain: '_vercel.example.com',
            value: 'vc-domain-verify=www.example.com,abc123',
            reason: 'pending_domain_verification',
          },
        ],
      }),
    });

    const diagnosis = diagnose(facts);

    expect(diagnosis.remediation.conflicts).toHaveLength(1);
    expect(diagnosis.remediation.pointing?.options).toContainEqual({
      kind: 'nameservers',
      nameservers: ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'],
    });
    expect(diagnosis.remediation.verification?.challenges).toHaveLength(1);
  });
});
