import type { PipedriveBaseParams } from '@/tools/pipedrive/types'

/**
 * Builds the auth headers for a Pipedrive API request. OAuth access tokens use
 * `Authorization: Bearer`; pasted personal API tokens (token-paste service
 * accounts) must use the `x-api-token` header instead — Pipedrive documents no
 * token-format discriminator, so the credential resolver threads an explicit
 * `authStyle` signal through the token route into tool params. Works on both
 * `/v1` and `/api/v2` endpoints.
 */
export function getPipedriveAuthHeaders(params: PipedriveBaseParams): Record<string, string> {
  if (!params.accessToken) {
    throw new Error('Access token is required')
  }
  if (params.authStyle === 'x-api-token') {
    return {
      'x-api-token': params.accessToken,
      Accept: 'application/json',
    }
  }
  return {
    Authorization: `Bearer ${params.accessToken}`,
    Accept: 'application/json',
  }
}
