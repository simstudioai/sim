import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Browser Use's account billing endpoint answers 200 for a valid key and 401 otherwise. */
export const validateBrowserUseServiceAccount = tokenCheckValidator({
  serviceLabel: 'Browser Use',
  request: ({ apiToken }) => ({
    url: 'https://api.browser-use.com/api/v2/billing/account',
    headers: { 'X-Browser-Use-API-Key': apiToken, Accept: 'application/json' },
  }),
})
