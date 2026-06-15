import { AGENT_STATUS } from '../../util/agent-output-constants';
import type { ProjectStatus } from './verify-acquisition';
import type { DomainDiagnosis, NextStep } from './verify-diagnosis';

export interface StructuredVerificationError {
  reason: string;
  code: string;
  message: string;
  next?: NextStep[];
}

export function renderStructuredOutput(diagnosis: DomainDiagnosis): string {
  const { facts } = diagnosis;
  const { config } = facts;
  const payload = {
    status: diagnosis.ok ? AGENT_STATUS.OK : AGENT_STATUS.ACTION_REQUIRED,
    ...diagnosis.details,
    ...(diagnosis.next.length ? { next: diagnosis.next } : {}),
    ...(diagnosis.remediation.domainConnect
      ? { domainConnect: diagnosis.remediation.domainConnect }
      : {}),
    domain: facts.domainName,
    domainStatus: diagnosis.status,
    configurationStatus: diagnosis.configurationStatus,
    ok: diagnosis.ok,
    issues: diagnosis.issues,
    misconfigured: config.misconfigured,
    configuredBy: config.configuredBy,
    serviceType: config.serviceType,
    ipStatus: config.ipStatus ?? null,
    dnssecEnabled: config.dnssecEnabled ?? null,
    acceptedChallenges: config.acceptedChallenges ?? [],
    current: {
      nameservers: config.nameservers ?? [],
      cnames: config.cnames ?? [],
      aValues: config.aValues ?? [],
    },
    recommended: {
      ipv4: config.recommendedIPv4 ?? [],
      cname: config.recommendedCNAME ?? [],
      records: diagnosis.recommendedDnsRecords,
      nameservers: facts.intendedNameservers,
    },
    conflicts: config.conflicts ?? [],
    domainOwnership: facts.ownership,
    project: serializeProject(facts.project),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function renderStructuredError(
  error: StructuredVerificationError
): string {
  return `${JSON.stringify(
    {
      status: AGENT_STATUS.ERROR,
      reason: error.reason,
      error: error.code,
      message: error.message,
      ...(error.next?.length ? { next: error.next } : {}),
    },
    null,
    2
  )}\n`;
}

function serializeProject(project: ProjectStatus) {
  switch (project.kind) {
    case 'none':
      return null;
    case 'attached':
      return {
        idOrName: project.label,
        attached: true,
        verified: project.domain.verified,
        verification: project.domain.verification ?? [],
        verificationError: project.verificationError
          ? {
              code: project.verificationError.code || 'verification_failed',
              message:
                project.verificationError.serverMessage ||
                project.verificationError.message,
            }
          : null,
      };
    case 'missing':
      return { idOrName: project.idOrName, attached: false };
  }
}
