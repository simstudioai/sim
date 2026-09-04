import { interruptibleSleep } from '@sim/utils/helpers'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import {
  type SecureFetchResponse,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { consumeOrCancelBody, isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { normalizeOracleFusionApplicationOrigin } from '@/lib/credentials/client-credential-accounts/descriptors'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { isOracleFusionIntegralJsonNumberToken } from '@/lib/internal/oracle-fusion/identifiers'
import {
  buildOracleFusionResourcePath,
  type OracleFusionResourceAddress,
} from '@/lib/internal/oracle-fusion/paths'

const REQUEST_TIMEOUT_MS = 30_000
const RESPONSE_MAX_BYTES = 5 * 1024 * 1024
const MAX_RETRIES = 2
const TRANSIENT_STATUSES = new Set([429, 503, 504])
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

interface JsonParseContext {
  source?: string
}

type JsonParseWithSource = (
  text: string,
  reviver: (this: unknown, key: string, value: unknown, context?: JsonParseContext) => unknown
) => unknown

const jsonParseWithSource = JSON.parse as JsonParseWithSource

export interface OracleFusionResolvedCredential {
  instanceUrl: string
  accessToken: string
}

export interface OracleFusionRequest {
  address: OracleFusionResourceAddress
  query?: Record<string, string | number | boolean | undefined>
}

function validateBasicCredential(accessToken: string): void {
  if (
    !accessToken ||
    accessToken.length > 4096 ||
    accessToken.length % 4 !== 0 ||
    !CANONICAL_BASE64.test(accessToken)
  ) {
    throw new Error('Oracle Fusion credential is malformed')
  }
}

function buildRequestUrl(origin: string, request: OracleFusionRequest): string {
  const resourcePath = buildOracleFusionResourcePath(request.address)
  const url = new URL(`${origin}${resourcePath}`)
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value === undefined) continue
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('Oracle Fusion query values must be finite')
    }
    url.searchParams.set(key, String(value))
  }
  if (url.origin !== origin || url.pathname !== resourcePath) {
    throw new Error('Oracle Fusion request must remain on the credential-bound API root')
  }
  return url.toString()
}

function parseOracleFusionJson(body: string): unknown {
  return jsonParseWithSource(body, (_key, value, context) => {
    if (typeof value !== 'number' || Number.isSafeInteger(value)) return value
    const source = context?.source
    return source && isOracleFusionIntegralJsonNumberToken(source) ? source : value
  })
}

async function waitForRetry(
  attempt: number,
  signal?: AbortSignal,
  retryAfterMs: number | null = null
): Promise<void> {
  const delay = backoffWithJitter(attempt + 1, retryAfterMs, {
    baseMs: 250,
    maxMs: 30_000,
  })
  await interruptibleSleep(delay, signal)
  signal?.throwIfAborted()
}

async function fetchAttempt(
  url: string,
  resolvedIP: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<SecureFetchResponse> {
  return secureFetchWithPinnedIP(url, resolvedIP, {
    profile: 'configuredEndpoint',
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${accessToken}`,
      'REST-Framework-Version': '9',
    },
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 0,
    maxResponseBytes: RESPONSE_MAX_BYTES,
    signal,
    logUrlValidationDetails: false,
  })
}

function statusMessage(status: number): string {
  if (status === 401) return 'Oracle Fusion authentication failed'
  if (status === 403) return 'Oracle Fusion denied this request'
  if (status === 404) return 'Oracle Fusion resource was not found'
  if (status === 429) return 'Oracle Fusion rate limit exceeded'
  return `Oracle Fusion request failed with HTTP ${status}`
}

/** `maxRedirects: 0` rejects a response with Location before returning its status. */
function isRejectedRedirect(error: unknown): boolean {
  return error instanceof Error && error.message === 'Too many redirects (max: 0)'
}

/** Executes one bounded, DNS-pinned GET against a fixed Oracle product API family. */
export async function requestOracleFusionJson(
  credential: OracleFusionResolvedCredential,
  request: OracleFusionRequest,
  signal?: AbortSignal
): Promise<unknown> {
  signal?.throwIfAborted()
  const origin = normalizeOracleFusionApplicationOrigin(credential.instanceUrl)
  if (!origin) {
    throw new Error('Oracle Fusion credential is not bound to a canonical application URL')
  }
  validateBasicCredential(credential.accessToken)
  const url = buildRequestUrl(origin, request)

  let validation: Awaited<ReturnType<typeof validateUrlWithDNS>>
  try {
    validation = await validateUrlWithDNS(origin, 'Fusion Applications URL', 'configuredEndpoint', {
      logDetails: false,
    })
  } catch {
    signal?.throwIfAborted()
    throw new Error('Oracle Fusion credential application URL could not be validated')
  }
  signal?.throwIfAborted()
  if (!validation.isValid) {
    throw new Error('Oracle Fusion credential application URL is not a public endpoint')
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    signal?.throwIfAborted()
    let response: SecureFetchResponse
    try {
      response = await fetchAttempt(url, validation.resolvedIP, credential.accessToken, signal)
    } catch (error) {
      signal?.throwIfAborted()
      if (isRejectedRedirect(error)) {
        throw new OracleFusionProviderError('Oracle Fusion returned a redirect', 502)
      }
      if (isPayloadSizeLimitError(error)) {
        throw new OracleFusionProviderError('Oracle Fusion response exceeded 5 MiB', 502)
      }
      if (error instanceof Error && error.message.includes('timed out')) {
        throw new OracleFusionProviderError('Oracle Fusion request timed out', 504)
      }
      throw new OracleFusionProviderError('Could not reach Oracle Fusion', 502)
    }

    if (TRANSIENT_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), 30_000)
      await consumeOrCancelBody(response)
      await waitForRetry(attempt, signal, retryAfterMs)
      continue
    }

    if (!response.ok) {
      await consumeOrCancelBody(response)
      signal?.throwIfAborted()
      throw new OracleFusionProviderError(statusMessage(response.status), response.status)
    }

    let body: string
    try {
      body = await response.text()
    } catch (error) {
      signal?.throwIfAborted()
      if (isPayloadSizeLimitError(error)) {
        throw new OracleFusionProviderError('Oracle Fusion response exceeded 5 MiB', 502)
      }
      throw new OracleFusionProviderError('Oracle Fusion response could not be read', 502)
    }
    signal?.throwIfAborted()
    try {
      return parseOracleFusionJson(body)
    } catch {
      throw new OracleFusionProviderError('Oracle Fusion returned malformed JSON', 502)
    }
  }

  throw new OracleFusionProviderError('Oracle Fusion retry limit was exhausted', 502)
}
