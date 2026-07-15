import { truncate } from '@sim/utils/string'

/**
 * Discrete validation failure codes returned to the client for token
 * service-account credentials. The UI maps each code to a human message; raw
 * provider response bodies stay in server logs.
 */
export type TokenServiceAccountValidationCode =
  | 'invalid_credentials'
  | 'site_not_found'
  | 'provider_unavailable'

export class TokenServiceAccountValidationError extends Error {
  constructor(
    public readonly code: TokenServiceAccountValidationCode,
    public readonly status: number,
    public readonly logDetail?: Record<string, unknown>
  ) {
    super(code)
    this.name = 'TokenServiceAccountValidationError'
  }
}

const ERROR_SNIPPET_MAX_LENGTH = 500

/**
 * Reads a bounded snippet of a provider error body for server logs. Never
 * throws — an unreadable body logs as an empty string.
 */
export async function readProviderErrorSnippet(res: Response): Promise<string> {
  try {
    return truncate(await res.text(), ERROR_SNIPPET_MAX_LENGTH)
  } catch {
    return ''
  }
}

/**
 * Maps a failed provider verification response to the standard error split:
 * 401/403 mean the pasted token was rejected (`invalid_credentials`), anything
 * else non-2xx means the provider couldn't be reached or misbehaved
 * (`provider_unavailable`) — never blame the token for a provider outage.
 */
export async function throwForProviderResponse(
  res: Response,
  step: string,
  context: Record<string, unknown> = {}
): Promise<void> {
  if (res.ok) return
  const body = await readProviderErrorSnippet(res)
  if (res.status === 401 || res.status === 403) {
    throw new TokenServiceAccountValidationError('invalid_credentials', res.status, {
      step,
      body,
      ...context,
    })
  }
  throw new TokenServiceAccountValidationError('provider_unavailable', res.status, {
    step,
    body,
    ...context,
  })
}
