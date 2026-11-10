import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** The data center suffix (`-us21`) that names the key's API host. */
const DATA_CENTER_SUFFIX = /-([a-z]+\d+)$/

/**
 * Mailchimp's ping endpoint answers 200 for a valid key and 401 otherwise. The
 * host comes from the key's data center suffix, which must match before any
 * request so a crafted key can never point the check at another host.
 */
export const validateMailchimpServiceAccount = tokenCheckValidator({
  serviceLabel: 'Mailchimp',
  request: ({ apiToken }) => {
    const dataCenter = DATA_CENTER_SUFFIX.exec(apiToken)?.[1]
    if (!dataCenter) {
      throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
        step: 'verify',
        reason: 'Mailchimp API key has no data center suffix',
      })
    }
    return {
      url: `https://${dataCenter}.api.mailchimp.com/3.0/ping`,
      headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
    }
  },
})
