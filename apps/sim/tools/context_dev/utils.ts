/** Base URL for all Context.dev API endpoints. */
export const CONTEXT_DEV_BASE_URL = 'https://api.context.dev/v1'

/**
 * Builds the standard Context.dev request headers with Bearer authentication.
 */
export function contextDevHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  }
}

/**
 * Builds JSON request headers with Bearer authentication for POST endpoints.
 */
export function contextDevJsonHeaders(apiKey: string): Record<string, string> {
  return {
    ...contextDevHeaders(apiKey),
    'Content-Type': 'application/json',
  }
}

/**
 * Throws a descriptive error when a Context.dev response is not successful.
 * Returns the parsed JSON body on success.
 */
export async function parseContextDevResponse(response: Response): Promise<any> {
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Context.dev API error (${response.status}): ${errorText}`)
  }
  return response.json()
}

/** Shape of the credit accounting object present on every Context.dev response. */
interface ContextDevKeyMetadata {
  credits_consumed?: number
  credits_remaining?: number
}

/**
 * Extracts the credit accounting fields shared by every Context.dev response.
 */
export function extractCreditMetadata(keyMetadata: ContextDevKeyMetadata | undefined): {
  creditsConsumed: number | null
  creditsRemaining: number | null
} {
  return {
    creditsConsumed: keyMetadata?.credits_consumed ?? null,
    creditsRemaining: keyMetadata?.credits_remaining ?? null,
  }
}

/**
 * Normalizes a brand-returning Context.dev response into the shared tool output shape.
 * Used by every endpoint that returns a `brand` object.
 */
export function transformBrandResponse(data: any): {
  status: string
  brand: Record<string, unknown> | null
  creditsConsumed: number | null
  creditsRemaining: number | null
} {
  return {
    status: data.status ?? '',
    brand: data.brand ?? null,
    ...extractCreditMetadata(data.key_metadata),
  }
}

/**
 * Appends a parameter to a URLSearchParams instance only when it is defined and non-empty.
 * Booleans are serialized as the literal strings 'true' / 'false'.
 */
export function appendParam(
  search: URLSearchParams,
  key: string,
  value: string | number | boolean | undefined | null
): void {
  if (value === undefined || value === null || value === '') return
  const serialized = typeof value === 'string' ? value.trim() : String(value)
  if (serialized === '') return
  search.append(key, serialized)
}

/** Output definitions for the credit accounting fields, reused across every tool. */
export const CREDIT_OUTPUTS = {
  creditsConsumed: {
    type: 'number',
    description: 'Credits consumed by this request',
    optional: true,
  },
  creditsRemaining: {
    type: 'number',
    description: 'Credits remaining on the API key',
    optional: true,
  },
} as const
