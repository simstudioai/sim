import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Bright Data's active-zones listing answers 200 for a valid token and 401 otherwise. */
export const validateBrightDataServiceAccount = tokenCheckValidator({
  serviceLabel: 'Bright Data',
  request: ({ apiToken }) => ({
    url: 'https://api.brightdata.com/zone/get_active_zones',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
