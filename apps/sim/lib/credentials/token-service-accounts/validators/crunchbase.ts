import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Crunchbase's autocomplete endpoint answers 200 for a valid user key and 401 otherwise. */
export const validateCrunchbaseServiceAccount = tokenCheckValidator({
  serviceLabel: 'Crunchbase',
  request: ({ apiToken }) => ({
    url: 'https://api.crunchbase.com/v4/data/autocompletes?query=a&limit=1',
    headers: { 'X-cb-user-key': apiToken, Accept: 'application/json' },
  }),
})
