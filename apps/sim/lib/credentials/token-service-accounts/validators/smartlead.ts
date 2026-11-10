import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Smartlead answers 401 for an invalid key; listing one email account is the cheapest authenticated read. */
export const validateSmartleadServiceAccount = tokenCheckValidator({
  serviceLabel: 'Smartlead',
  request: ({ apiToken }) => ({
    url: `https://server.smartlead.ai/api/v1/email-accounts/?api_key=${encodeURIComponent(apiToken)}&offset=0&limit=1`,
    headers: { Accept: 'application/json' },
  }),
})
