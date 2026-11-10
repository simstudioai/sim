import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/**
 * Listing accounts succeeds for any valid user- or account-owned API token
 * (`/user/tokens/verify` rejects account-owned ones) and fails for a bad token.
 */
export const validateCloudflareServiceAccount = tokenCheckValidator({
  serviceLabel: 'Cloudflare',
  request: ({ apiToken }) => ({
    url: 'https://api.cloudflare.com/client/v4/accounts?per_page=1',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
