import { getErrorMessage } from '@sim/utils/errors'
import { normalizeHttpBaseUrl } from '@/lib/core/security/input-validation'

const INFISICAL_US_CLOUD_URL = 'https://us.infisical.com'

/**
 * An Infisical API URL on the configured instance. A blank instance URL means
 * US Cloud; any other is normalized exactly as a saved Infisical credential's
 * instance URL is, so inline and saved connections reach the same host and an
 * unusable URL is refused rather than retargeting the bearer token.
 */
export function infisicalApiUrl(baseUrl: string | undefined, path: string): string {
  if (!baseUrl?.trim()) return `${INFISICAL_US_CLOUD_URL}${path}`
  try {
    return `${normalizeHttpBaseUrl(baseUrl)}${path}`
  } catch (error) {
    throw new Error(`Invalid Infisical instance URL: ${getErrorMessage(error)}`)
  }
}
