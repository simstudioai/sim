import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/**
 * A one-row contact search costs no credits, works without a master key, and
 * answers 200 for a valid key and 401 otherwise (the health endpoint answers
 * 200 even for a bad key, so it cannot be used).
 */
export const validateApolloServiceAccount = tokenCheckValidator({
  serviceLabel: 'Apollo',
  request: ({ apiToken }) => ({
    url: 'https://api.apollo.io/api/v1/contacts/search',
    method: 'POST',
    headers: {
      'X-Api-Key': apiToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ page: 1, per_page: 1 }),
  }),
})
