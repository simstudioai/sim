import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Profound's organization categories endpoint answers 200 for a valid key and 401 otherwise. */
export const validateProfoundServiceAccount = tokenCheckValidator({
  serviceLabel: 'Profound',
  request: ({ apiToken }) => ({
    url: 'https://api.tryprofound.com/v1/org/categories',
    headers: { 'X-API-Key': apiToken, Accept: 'application/json' },
  }),
})
