import type { GetSecretValueCommandOutput } from '@aws-sdk/client-secrets-manager'
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { createLogger } from '@sim/logger'
import {
  isEnvironmentProxyConfigured,
  resolveEnvironmentProxy,
} from '@sim/security/environment-proxy'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import { FetchHttpHandler } from '@smithy/fetch-http-handler'
import { NodeHttpHandler } from '@smithy/node-http-handler'

const logger = createLogger('RuntimeSecrets')

/** Plaintext env var (set in the ECS task definition) naming the secret to ingest. */
const SECRET_ID_ENV = 'SIM_ENV_SECRET_ID'

const MAX_ATTEMPTS = 3

/** Bounds each Secrets Manager request so a stalled response can't hang boot. */
const REQUEST_TIMEOUT_MS = 5000

/**
 * Fetches the combined `/{env}/sim/env-vars` secret once at container boot and
 * hydrates `process.env`, so secrets no longer have to be fanned out into the
 * ECS task definition (which is approaching the 64 KB rendered-document limit).
 *
 * Must run before any application module that reads env at import time. No-ops
 * when {@link SECRET_ID_ENV} is unset (local dev / self-hosted keep using their
 * own env). Existing `process.env` keys are never overwritten, so explicit
 * task-definition `environment` entries win. Throws on any fetch/parse failure
 * so a misconfigured container crashes instead of booting without its config.
 */
export async function loadRuntimeSecrets(): Promise<void> {
  const secretId = process.env[SECRET_ID_ENV]
  if (!secretId) {
    logger.info(`${SECRET_ID_ENV} not set; skipping runtime secret ingestion`)
    return
  }

  const entries = await fetchRuntimeSecrets(secretId)

  let loaded = 0
  let skipped = 0
  for (const [key, value] of Object.entries(entries)) {
    if (key in process.env) {
      skipped++
      continue
    }
    process.env[key] = value
    loaded++
  }

  logger.info('Runtime secrets ingested', { secretId, loaded, skipped })
}

/**
 * Reads one env-vars JSON secret as the string map a process would see: the
 * same values {@link loadRuntimeSecrets} writes into `process.env`, with
 * non-string JSON values serialized. Retries a failed request up to three
 * times, then throws, so a caller never proceeds on a partial or missing secret.
 */
export async function fetchRuntimeSecrets(secretId: string): Promise<Record<string, string>> {
  const requestHandler = proxyAwareRequestHandler()
  const client = new SecretsManagerClient({
    ...(process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {}),
    ...(requestHandler ? { requestHandler } : {}),
  })
  const entries = parseSecretJson(await fetchSecretString(client, secretId))
  return Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [
      key,
      typeof value === 'string' ? value : JSON.stringify(value),
    ])
  )
}

/**
 * Sends each request the way the app's `awsRequestHandler` would: through the `HTTPS_PROXY` /
 * `HTTP_PROXY` that applies to its destination (an https endpoint falls back to `HTTP_PROXY`),
 * or directly when `NO_PROXY` excludes it, using the same rules from `@sim/security`. Proxied
 * requests go through Bun's `fetch` with the proxy passed explicitly, since Bun's own lookup
 * picks a proxy by scheme only and would skip an https endpoint when just `HTTP_PROXY` is set.
 */
class EnvironmentProxyHandler extends FetchHttpHandler {
  private readonly direct = new NodeHttpHandler()

  constructor() {
    super({
      customFetch: (input, init) => {
        const url = input instanceof Request ? input.url : String(input)
        const proxied: RequestInit & { proxy?: string } = {
          ...init,
          proxy: resolveEnvironmentProxy(new URL(url)) ?? undefined,
        }
        return fetch(input, proxied)
      },
    })
  }

  override handle(...args: Parameters<FetchHttpHandler['handle']>) {
    const [request, options] = args
    const port = request.port ? `:${request.port}` : ''
    const target = new URL(`${request.protocol}//${request.hostname}${port}`)
    if (resolveEnvironmentProxy(target)) return super.handle(request, options)
    return this.direct.handle(request, options)
  }

  override destroy() {
    this.direct.destroy()
    super.destroy()
  }
}

/**
 * The SDK's default Node handler ignores `HTTPS_PROXY`, so a container whose only egress is a
 * proxy could not fetch its config and would never boot. Both container bootstraps run on Bun,
 * so while a proxy is set this returns an {@link EnvironmentProxyHandler}. The app's
 * `awsRequestHandler` lives in `apps/sim`, which packages cannot import. Undefined otherwise,
 * leaving the SDK default in place.
 */
function proxyAwareRequestHandler(): EnvironmentProxyHandler | undefined {
  if (!process.versions.bun || !isEnvironmentProxyConfigured()) return undefined
  return new EnvironmentProxyHandler()
}

async function fetchSecretString(client: SecretsManagerClient, secretId: string): Promise<string> {
  const response = await sendWithRetry(client, secretId)
  if (!response.SecretString) {
    // Non-retriable: a binary secret will never become a string between attempts.
    throw new Error('Secret has no SecretString (binary secrets are not supported)')
  }
  return response.SecretString
}

async function sendWithRetry(
  client: SecretsManagerClient,
  secretId: string
): Promise<GetSecretValueCommandOutput> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await client.send(new GetSecretValueCommand({ SecretId: secretId }), {
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      lastError = error
      if (attempt < MAX_ATTEMPTS) {
        const delay = backoffWithJitter(attempt, null, { baseMs: 200, maxMs: 2000 })
        logger.warn(
          `Failed to fetch runtime secrets (attempt ${attempt}/${MAX_ATTEMPTS}), retrying`,
          { error: getErrorMessage(error) }
        )
        await sleep(delay)
      }
    }
  }
  throw new Error(`Failed to fetch runtime secrets from ${secretId}: ${getErrorMessage(lastError)}`)
}

function parseSecretJson(secretString: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(secretString)
  } catch {
    // The parser's message quotes the text around the fault, which can be part of a value.
    throw new Error('Runtime secret is not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Runtime secret must be a JSON object of key/value pairs')
  }
  return parsed as Record<string, unknown>
}
