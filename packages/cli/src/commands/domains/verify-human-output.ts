import chalk from 'chalk';
import output from '../../output-manager';
import chars from '../../util/output/chars';
import code from '../../util/output/code';
import table from '../../util/output/table';
import type {
  DomainDiagnosis,
  PointingOption,
  RecommendedDnsRecord,
} from './verify-diagnosis';

export interface HumanVerificationOutput {
  lead: {
    kind: 'success' | 'log';
    message: string;
  };
  sections: string[];
}

export function renderHumanOutput(
  diagnosis: DomainDiagnosis,
  elapsed: string
): HumanVerificationOutput {
  if (diagnosis.status === 'configured-correctly') {
    return {
      lead: {
        kind: 'success',
        message: `${successMessage(diagnosis)} ${chalk.gray(elapsed)}`,
      },
      sections: [],
    };
  }

  return {
    lead: {
      kind: 'log',
      message: `Checked ${diagnosis.facts.domainName} under ${chalk.bold(
        diagnosis.facts.contextName
      )} ${chalk.gray(elapsed)}`,
    },
    sections: [
      renderStatus(diagnosis),
      renderFixes(diagnosis),
      renderResolvedValues(diagnosis),
      renderNameservers(diagnosis),
    ].filter((section): section is string => section !== null),
  };
}

function successMessage(diagnosis: DomainDiagnosis): string {
  const { facts } = diagnosis;
  const configuredBy = describeConfiguredBy(facts.config.configuredBy);
  const suffix =
    facts.project.kind === 'attached'
      ? ` and verified for project ${chalk.bold(facts.project.label)}`
      : '';
  return `Valid Configuration: ${facts.domainName} is configured${
    configuredBy ? ` (${configuredBy})` : ''
  }${suffix}`;
}

function describeConfiguredBy(
  configuredBy: DomainDiagnosis['facts']['config']['configuredBy']
): string | null {
  switch (configuredBy) {
    case 'A':
      return 'A record';
    case 'CNAME':
      return 'CNAME record';
    case 'http':
      return 'HTTP resolution, possibly behind a proxy';
    case 'dns-01':
      return 'DNS-01 challenge only, not yet resolving to Vercel';
    default:
      return null;
  }
}

const good = (text: string) => `${chalk.green(chars.tick)} ${text}`;
const bad = (text: string) => `${chalk.red(chars.cross)} ${text}`;
const warning = (text: string) => `${chalk.yellow('!')} ${text}`;

function renderStatus(diagnosis: DomainDiagnosis): string {
  const { facts } = diagnosis;
  const rows = [
    [chalk.cyan('DNS Configuration'), dnsStatus(diagnosis)],
    [chalk.cyan('Project'), projectStatus(diagnosis)],
  ];
  if (facts.ownership === 'other-scope') {
    rows.push([
      chalk.cyan('Ownership'),
      bad(`Not accessible under ${chalk.bold(facts.contextName)}`),
    ]);
  } else if (facts.ownership === 'platform-managed') {
    rows.push([chalk.cyan('Ownership'), good('Managed by Vercel')]);
  }
  if (
    facts.config.dnssecEnabled &&
    diagnosis.configurationStatus !== 'scope-resolution-required'
  ) {
    rows.push([chalk.cyan('DNSSEC'), chalk.yellow('Enabled')]);
  }

  return `\n${chalk.bold('  Status')}\n\n${indent(
    table(rows, { hsep: 4 })
  )}\n\n`;
}

function dnsStatus(diagnosis: DomainDiagnosis): string {
  switch (diagnosis.configurationStatus) {
    case 'invalid-configuration':
      return bad('Invalid Configuration');
    case 'dns-change-required':
      return bad('DNS Change Required');
    case 'dnssec-needs-to-be-disabled':
      return bad('DNSSEC Needs to be Disabled');
    case 'dns-change-recommended':
      return warning('DNS Change Recommended');
    case 'scope-resolution-required':
      return chalk.gray('Not assessed in this scope');
    case 'configured-correctly':
      break;
  }
  const configuredBy = describeConfiguredBy(
    diagnosis.facts.config.configuredBy
  );
  return good(`Valid Configuration${configuredBy ? ` (${configuredBy})` : ''}`);
}

function projectStatus(diagnosis: DomainDiagnosis): string {
  const { facts } = diagnosis;
  if (diagnosis.configurationStatus === 'scope-resolution-required') {
    return chalk.gray('Not assessed in this scope');
  }
  switch (facts.project.kind) {
    case 'attached':
      return facts.project.domain.verified
        ? good(`Verified for ${chalk.bold(facts.project.label)}`)
        : bad(`Verification Needed for ${chalk.bold(facts.project.label)}`);
    case 'missing':
      return bad(
        `Not attached to project ${chalk.bold(facts.project.idOrName)}`
      );
    case 'none':
      return chalk.gray(
        `Not attached to any project under ${facts.contextName}`
      );
  }
}

function renderFixes(diagnosis: DomainDiagnosis): string | null {
  const steps = [
    scopeStep(diagnosis),
    domainConnectStep(diagnosis),
    pointingStep(diagnosis),
    dnssecStep(diagnosis),
    ...conflictSteps(diagnosis),
    ...verificationSteps(diagnosis),
    attachProjectStep(diagnosis),
  ].filter((step): step is string => step !== null);

  if (!steps.length) {
    return null;
  }

  const heading = diagnosis.ok ? '  Recommended change' : '  What to fix';
  const body = steps
    .map((step, index) => {
      const text = `    ${chalk.grey(`${index + 1}.`)} ${step}`.replace(
        /[ \t]+$/gm,
        ''
      );
      return `${text}\n`;
    })
    .join('\n');

  return `${chalk.bold(heading)}\n\n${body}\n`;
}

function scopeStep(diagnosis: DomainDiagnosis): string | null {
  const scope = diagnosis.remediation.scope;
  if (!scope) {
    return null;
  }
  return `${diagnosis.facts.domainName} exists on Vercel but is not accessible under ${chalk.bold(
    scope.contextName
  )}. If it belongs to another team you are a member of, list your teams with ${code(
    scope.teamsCommand
  )}, then retry with ${code(scope.verifyCommand)}.`;
}

function domainConnectStep(diagnosis: DomainDiagnosis): string | null {
  const domainConnect = diagnosis.remediation.domainConnect;
  if (!domainConnect) {
    return null;
  }
  const applyUrl = output.link(domainConnect.applyUrl, domainConnect.applyUrl, {
    fallback: false,
  });
  return `Auto configure the DNS records with Cloudflare using Domain Connect:\n       ${applyUrl}\n\n       Open the URL to review and approve the DNS changes in Cloudflare.`;
}

function pointingStep(diagnosis: DomainDiagnosis): string | null {
  const pointing = diagnosis.remediation.pointing;
  if (!pointing) {
    return null;
  }
  if (!pointing.options.length) {
    return 'Point the domain to Vercel by setting the recommended DNS records for your project.';
  }

  const intro =
    pointing.kind === 'point-domain'
      ? `Point ${diagnosis.facts.domainName} to Vercel with one of the following options:`
      : pointing.kind === 'recommended-change'
        ? diagnosis.facts.ownership === 'current-scope' &&
          diagnosis.facts.project.kind === 'none'
          ? `No action is needed for an unused hostname. If ${diagnosis.facts.domainName} is intentionally in use, update its DNS records with one of the following options:`
          : `Vercel recommends updating the DNS records for ${diagnosis.facts.domainName} with one of the following options:`
        : `To avoid downtime, update the DNS records for ${diagnosis.facts.domainName} with one of the following options:`;
  const lines = [intro];
  pointing.options.forEach((option, index) => {
    const letter = String.fromCharCode(97 + index);
    const title = pointingOptionTitle(option);
    lines.push('', `${chalk.grey(`${letter})`)} ${title}`);
    for (const record of pointingOptionRecords(option)) {
      lines.push(`   ${chalk.cyan(record)}`);
    }
  });
  return lines.join('\n       ');
}

function pointingOptionTitle(option: PointingOption): string {
  switch (option.kind) {
    case 'a-records':
      return option.records.length === 1
        ? 'Add an A record:'
        : 'Add A records:';
    case 'cname-records':
      return 'Add a CNAME record:';
    case 'nameservers':
      return 'Switch to the Vercel nameservers:';
  }
}

function pointingOptionRecords(option: PointingOption): string[] {
  return option.kind === 'nameservers'
    ? option.nameservers
    : option.records.map(formatDnsRecord);
}

function formatDnsRecord(record: RecommendedDnsRecord): string {
  const columns =
    record.type === 'A'
      ? `A      ${record.name}  ${record.value}`
      : `CNAME  ${record.name}  ${record.value}`;
  return record.disableProxy ? `${columns}  (Proxy: Disabled)` : columns;
}

function dnssecStep(diagnosis: DomainDiagnosis): string | null {
  return diagnosis.remediation.disableDnssec
    ? "Disable DNSSEC with your domain registrar. The domain's nameservers point to Vercel, but DNSSEC prevents them from resolving globally."
    : null;
}

function conflictSteps(diagnosis: DomainDiagnosis): string[] {
  return diagnosis.remediation.conflicts.map(conflict => {
    const caaHint =
      conflict.type === 'CAA'
        ? ' (it prevents Vercel from issuing TLS certificates)'
        : '';
    return `Remove the conflicting ${conflict.type} record ${code(
      `${conflict.type} ${conflict.name} ${conflict.value}`
    )}${caaHint}.`;
  });
}

function verificationSteps(diagnosis: DomainDiagnosis): string[] {
  const verification = diagnosis.remediation.verification;
  if (!verification) {
    return [];
  }

  const steps = verification.challenges.map(
    challenge =>
      `Verify domain ownership by adding the following record to your DNS provider. You can remove it after verification is complete:\n       ${code(
        `${challenge.type} ${challenge.domain} "${challenge.value}"`
      )}`
  );

  if (verification.errorMessage) {
    const message = `Last attempt: ${verification.errorMessage}`;
    if (steps.length) {
      steps[steps.length - 1] += `\n       ${chalk.gray(message)}`;
    } else {
      steps.push(message);
    }
  }

  return steps;
}

function attachProjectStep(diagnosis: DomainDiagnosis): string | null {
  const attachProject = diagnosis.remediation.attachProject;
  return attachProject
    ? `Add the domain to the project by running ${code(attachProject.command)}.`
    : null;
}

function renderResolvedValues(diagnosis: DomainDiagnosis): string | null {
  const config = diagnosis.facts.config;
  const rows = [
    ...(config.aValues ?? []).map(value => ['A', value]),
    ...(config.cnames ?? []).map(value => ['CNAME', value]),
  ];
  if (!rows.length) {
    return null;
  }

  return `${chalk.bold('  Currently resolves to')}\n\n${indent(
    table([[chalk.gray('Type'), chalk.gray('Value')], ...rows], { hsep: 4 })
  )}\n\n`;
}

function renderNameservers(diagnosis: DomainDiagnosis): string | null {
  const nameservers = diagnosis.facts.config.nameservers ?? [];
  if (!nameservers.length) {
    return null;
  }
  return `${chalk.bold('  Nameservers')}\n\n${indent(
    nameservers.join('\n')
  )}\n\n`;
}

function indent(block: string): string {
  return block
    .split('\n')
    .map(line => `    ${line}`)
    .join('\n');
}
