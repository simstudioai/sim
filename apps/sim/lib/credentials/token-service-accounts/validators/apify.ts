import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Apify's current-user endpoint answers 200 for a valid token and 401 otherwise. */
export const validateApifyServiceAccount = tokenCheckValidator({
  serviceLabel: 'Apify',
  forbiddenMeansScoped: true,
  request: ({ apiToken }) => ({
    url: 'https://api.apify.com/v2/users/me',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
