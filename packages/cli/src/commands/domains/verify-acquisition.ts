import type Client from '../../util/client';
import getScope from '../../util/get-scope';
import getDomainByName from '../../util/domains/get-domain-by-name';
import {
  getDomainConfigV6,
  type DomainConfigV6,
} from '../../util/domains/get-domain-config-v6';
import {
  getProjectDomain,
  getProjectDomainByName,
  verifyProjectDomain,
  type ProjectDomain,
} from '../../util/projects/get-project-domain';
import getProjectByNameOrId from '../../util/projects/get-project-by-id-or-name';
import { getLinkedProject } from '../../util/projects/link';
import {
  DomainNotFound,
  DomainPermissionDenied,
  isAPIError,
  type APIError,
} from '../../util/errors-ts';

export type DomainOwnership =
  | 'current-scope'
  | 'other-scope'
  | 'not-found'
  | null;

export type ProjectStatus =
  | {
      kind: 'attached';
      idOrName: string;
      label: string;
      domain: ProjectDomain;
      verificationError: APIError | null;
    }
  | { kind: 'missing'; idOrName: string }
  | { kind: 'none' };

type ProjectResolution =
  | ProjectStatus
  | { kind: 'forbidden'; idOrName: string }
  | { kind: 'error'; idOrName: string; error: APIError };

export interface VerificationFacts {
  domainName: string;
  contextName: string;
  teamId: string | undefined;
  config: DomainConfigV6;
  ownership: DomainOwnership;
  intendedNameservers: string[];
  project: ProjectStatus;
}

export interface VerificationAcquisitionOptions {
  domainName: string;
  project: string | undefined;
  strict: boolean;
}

export type VerificationAcquisitionErrorKind =
  | 'invalid-domain'
  | 'permission-denied'
  | 'timeout'
  | 'unexpected-dns-response'
  | 'api-error';

export interface VerificationAcquisitionError {
  kind: VerificationAcquisitionErrorKind;
  code: string;
  message: string;
}

export type VerificationAcquisitionResult =
  | { ok: true; facts: VerificationFacts }
  | { ok: false; error: VerificationAcquisitionError };

export async function acquireVerificationFacts(
  client: Client,
  options: VerificationAcquisitionOptions
): Promise<VerificationAcquisitionResult> {
  const { domainName } = options;
  const { contextName, team } = await getScope(client);
  const requests = [
    getDomainConfigV6(client, domainName, {
      projectIdOrName: options.project,
      strict: options.strict,
      bailOn429: true,
    }),
    resolveProject(client, domainName, options.project),
    lookupOwnership(client, contextName, domainName),
  ] as const;
  const [config, resolvedProject, owned] = await Promise.all(requests);

  if (isAPIError(config)) {
    return {
      ok: false,
      error: {
        kind: errorKind(config.code),
        code: config.code || 'api_error',
        message: configErrorMessage(config, domainName),
      },
    };
  }

  if (resolvedProject.kind === 'forbidden') {
    return {
      ok: false,
      error: {
        kind: 'permission-denied',
        code: 'forbidden',
        message: `You don't have access to the project ${resolvedProject.idOrName} under ${contextName}.`,
      },
    };
  }

  if (resolvedProject.kind === 'error') {
    return {
      ok: false,
      error: {
        kind: errorKind(resolvedProject.error.code),
        code: resolvedProject.error.code || 'api_error',
        message: projectErrorMessage(
          resolvedProject.error,
          resolvedProject.idOrName
        ),
      },
    };
  }

  const project = await triggerVerification(
    client,
    resolvedProject,
    domainName
  );

  return {
    ok: true,
    facts: {
      domainName,
      contextName,
      teamId: team?.id,
      config,
      ownership: owned.ownership,
      intendedNameservers: owned.intendedNameservers,
      project,
    },
  };
}

async function resolveProject(
  client: Client,
  domainName: string,
  requestedProject: string | undefined
): Promise<ProjectResolution> {
  if (requestedProject) {
    return resolveRequestedProject(client, domainName, requestedProject);
  }
  return (
    (await findLinkedProjectDomain(client, domainName)) ??
    (await findProjectDomainByName(client, domainName))
  );
}

async function resolveRequestedProject(
  client: Client,
  domainName: string,
  idOrName: string
): Promise<ProjectResolution> {
  const result = await getProjectDomain(client, idOrName, domainName, {
    bailOn429: true,
  });
  if (!isAPIError(result)) {
    return attachedProject(idOrName, idOrName, result);
  }
  if (result.status === 403) {
    return { kind: 'forbidden', idOrName };
  }
  if (result.status === 404) {
    return { kind: 'missing', idOrName };
  }
  return { kind: 'error', idOrName, error: result };
}

async function findLinkedProjectDomain(
  client: Client,
  domainName: string
): Promise<ProjectResolution | null> {
  const link = await getLinkedProject(client);
  if (link.status !== 'linked') {
    return null;
  }
  const result = await getProjectDomain(client, link.project.id, domainName, {
    bailOn429: true,
  });
  if (!isAPIError(result)) {
    return attachedProject(link.project.id, link.project.name, result);
  }
  return result.status === 403 || result.status === 404
    ? null
    : { kind: 'error', idOrName: link.project.id, error: result };
}

async function findProjectDomainByName(
  client: Client,
  domainName: string
): Promise<ProjectResolution> {
  const result = await getProjectDomainByName(client, domainName, {
    bailOn429: true,
  });
  if (isAPIError(result)) {
    return result.status === 403 || result.status === 404
      ? { kind: 'none' }
      : { kind: 'error', idOrName: domainName, error: result };
  }
  const label = await getProjectLabel(client, result.projectId);
  return attachedProject(result.projectId, label, result);
}

function attachedProject(
  idOrName: string,
  label: string,
  domain: ProjectDomain
): ProjectStatus {
  return { kind: 'attached', idOrName, label, domain, verificationError: null };
}

async function getProjectLabel(
  client: Client,
  projectId: string
): Promise<string> {
  try {
    const project = await getProjectByNameOrId(client, projectId);
    return project instanceof Error ? projectId : project.name;
  } catch {
    return projectId;
  }
}

async function lookupOwnership(
  client: Client,
  contextName: string,
  domainName: string
): Promise<{ ownership: DomainOwnership; intendedNameservers: string[] }> {
  try {
    const domain = await getDomainByName(client, contextName, domainName, {
      ignoreWait: true,
      bailOn429: true,
    });
    if (domain instanceof DomainPermissionDenied) {
      return { ownership: 'other-scope', intendedNameservers: [] };
    }
    if (domain instanceof DomainNotFound) {
      return { ownership: 'not-found', intendedNameservers: [] };
    }
    return {
      ownership: 'current-scope',
      intendedNameservers: domain.intendedNameservers,
    };
  } catch {
    return { ownership: null, intendedNameservers: [] };
  }
}

async function triggerVerification(
  client: Client,
  project: ProjectStatus,
  domainName: string
): Promise<ProjectStatus> {
  if (project.kind !== 'attached' || project.domain.verified) {
    return project;
  }
  const result = await verifyProjectDomain(
    client,
    project.idOrName,
    domainName,
    { bailOn429: true }
  );
  return isAPIError(result)
    ? { ...project, verificationError: result }
    : { ...project, domain: result };
}

function errorKind(
  errorCode: string | undefined
): VerificationAcquisitionErrorKind {
  switch (errorCode) {
    case 'invalid_name':
      return 'invalid-domain';
    case 'forbidden':
      return 'permission-denied';
    case 'timeout':
      return 'timeout';
    case 'unexpected_dns_response':
      return 'unexpected-dns-response';
    default:
      return 'api-error';
  }
}

function configErrorMessage(err: APIError, domainName: string): string {
  switch (err.code) {
    case 'invalid_name':
      return `${domainName} is not a valid domain name.`;
    case 'timeout':
      return `Resolving the DNS configuration for ${domainName} timed out. This is usually transient — try again in a few seconds.`;
    case 'unexpected_dns_response':
      return `The nameservers for ${domainName} returned an unexpected response while checking its DNS configuration.`;
    default:
      return err.serverMessage || `API error (${err.status})`;
  }
}

function projectErrorMessage(err: APIError, projectIdOrName: string): string {
  return (
    err.serverMessage ||
    err.message ||
    `Could not check project ${projectIdOrName} (${err.status}).`
  );
}
