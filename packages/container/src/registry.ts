import type { Span } from '@vercel/build-utils';
import type { ContainerEngine } from './engines/types';
import {
  debug,
  decodeOidcClaims,
  delay,
  done,
  readString,
  step,
  toTag,
} from './util';

/**
 * Ensure the target VCR repository exists before pushing.
 */
export async function ensureRepository(
  repository: string,
  token: string,
  claims: ReturnType<typeof decodeOidcClaims>,
  span?: Span
): Promise<void> {
  if (repository.includes('/')) {
    debug(`skipping repository auto-create (fully-qualified "${repository}")`);
    span?.setAttributes({ 'repository.create_result': 'skipped_qualified' });
    return;
  }

  const teamId = claims.owner_id;
  const projectId = claims.project_id;
  if (!teamId || !projectId) {
    debug(
      `skipping repository auto-create (missing ${
        !teamId ? 'team id' : 'project id'
      })`
    );
    span?.setAttributes({
      'repository.create_result': 'skipped_missing_ids',
    });
    return;
  }

  span?.setAttributes({ 'team.id': teamId, 'project.id': projectId });

  const apiUrl = (
    readString(process.env.VERCEL_API_URL) ?? 'https://api.vercel.com'
  ).replace(/\/+$/, '');
  const url = `${apiUrl}/v1/vcr/repository?teamId=${encodeURIComponent(teamId)}`;
  const body = JSON.stringify({ name: repository, projectId });

  step(`Ensuring registry repository "${repository}"`);
  debug(`repository create: POST ${url}`);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body,
    });
    span?.setAttributes({ 'repository.create_status': toTag(res.status) });
    if (res.ok) {
      span?.setAttributes({ 'repository.create_result': 'created' });
      done(`created repository "${repository}"`);
    } else if (res.status === 409) {
      span?.setAttributes({ 'repository.create_result': 'already_exists' });
      done(`repository "${repository}" already exists`);
    } else {
      span?.setAttributes({ 'repository.create_result': 'unexpected_status' });
      done('continuing — push will validate the repository');
    }
  } catch (err) {
    debug(`repository auto-create failed: ${(err as Error).message}`);
    span?.setAttributes({ 'repository.create_result': 'error' });
    done('continuing — push will validate the repository');
  }
}

/**
 * Block until the pushed image is usable in the registry.
 */
export async function waitForImageReady(
  engine: ContainerEngine,
  imageRef: string,
  span?: Span
): Promise<void> {
  if (process.env.VERCEL_VCR_SKIP_READY_CHECK === '1') {
    span?.setAttributes({ 'readiness.mode': 'skipped' });
    return;
  }

  const timeoutMs = Number(process.env.VERCEL_VCR_READY_TIMEOUT_MS) || 300_000;
  const intervalMs = Number(process.env.VERCEL_VCR_READY_INTERVAL_MS) || 3_000;
  const readyUrl = readString(process.env.VERCEL_VCR_READY_URL);
  const token = readString(process.env.VERCEL_OIDC_TOKEN);
  const deadline = Date.now() + timeoutMs;

  span?.setAttributes({
    'readiness.mode': readyUrl ? 'ready_url' : 'manifest_inspect',
    'readiness.engine': engine.name,
    'readiness.timeout_ms': toTag(timeoutMs),
  });

  debug(
    readyUrl
      ? `readiness: polling ${readyUrl} every ${intervalMs}ms`
      : `readiness: confirming digest resolves via ${engine.name} (timeout ${Math.round(timeoutMs / 1000)}s)`
  );

  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      if (readyUrl) {
        const res = await fetch(readyUrl, {
          headers: token ? { authorization: `Bearer ${token}` } : {},
        });
        debug(`readiness attempt ${attempt}: HTTP ${res.status}`);
        if (res.ok) {
          const body = (await res.json()) as {
            ready?: boolean;
            vhs?: unknown;
          };
          if (body.ready === true || Boolean(body.vhs)) {
            span?.setAttributes({ 'readiness.attempts': toTag(attempt) });
            return;
          }
        }
      } else {
        await engine.inspectRemoteImage(imageRef);
        debug(`readiness attempt ${attempt}: manifest resolved`);
        span?.setAttributes({ 'readiness.attempts': toTag(attempt) });
        return;
      }
    } catch (err) {
      debug(
        `readiness attempt ${attempt}: not ready (${(err as Error).message})`
      );
    }

    if (Date.now() >= deadline) {
      span?.setAttributes({
        'readiness.attempts': toTag(attempt),
        'readiness.timed_out': 'true',
      });
      throw new Error(
        `Timed out after ${Math.round(
          timeoutMs / 1000
        )}s waiting for "${imageRef}" to become ready in the Vercel Container Registry.`
      );
    }
    await delay(intervalMs);
  }
}
