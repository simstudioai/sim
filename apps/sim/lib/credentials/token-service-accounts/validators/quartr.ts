import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Listing one Quartr event type answers 200 for a valid key and 401 otherwise. */
export const validateQuartrServiceAccount = tokenCheckValidator({
  serviceLabel: 'Quartr',
  request: ({ apiToken }) => ({
    url: 'https://api.quartr.com/public/v3/event-types?limit=1',
    headers: { 'x-api-key': apiToken, Accept: 'application/json' },
  }),
})
