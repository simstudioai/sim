import { createLogger } from '@sim/logger'
import { toRecord } from '@sim/utils/object'
import { validateSalesforceInstanceUrl } from '@/lib/core/security/input-validation'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { isSalesforceLoginOrigin, SALESFORCE_LOGIN_HOSTS } from '@/lib/oauth/salesforce'

const logger = createLogger('SalesforceAccountDestination')

/** Resolves a token's API origin from Salesforce identity, never from model arguments. */
export async function fetchSalesforceInstanceUrl(
  providerId: string,
  accessToken: string
): Promise<string | undefined> {
  const loginHost = SALESFORCE_LOGIN_HOSTS[providerId]
  if (!loginHost) return undefined
  try {
    const response = await fetch(`https://${loginHost}/services/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      await response.body?.cancel()
      return undefined
    }
    const identity = toRecord(
      await readResponseJsonWithLimit(response, {
        maxBytes: 65_536,
        label: 'Salesforce account identity',
      })
    )
    for (const candidate of [toRecord(identity.urls).rest, identity.profile]) {
      if (typeof candidate !== 'string') continue
      const origin = validateSalesforceInstanceUrl(candidate)
      if (origin.isValid && origin.sanitized && !isSalesforceLoginOrigin(origin.sanitized))
        return origin.sanitized
    }
  } catch {
    logger.warn('Could not resolve Salesforce account destination', { providerId })
  }
  return undefined
}
