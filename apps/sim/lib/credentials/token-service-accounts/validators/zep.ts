import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Listing one thread needs a valid project key; Zep answers 401 for any other. */
export const validateZepServiceAccount = tokenCheckValidator({
  serviceLabel: 'Zep',
  request: ({ apiToken }) => ({
    url: 'https://api.getzep.com/api/v2/threads?page_size=1&page_number=1',
    headers: { Authorization: `Api-Key ${apiToken}`, Accept: 'application/json' },
  }),
})
