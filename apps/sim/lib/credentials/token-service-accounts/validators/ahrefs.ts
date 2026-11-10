import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Ahrefs' limits-and-usage endpoint is free, answers 200 for a valid key and 401 otherwise. */
export const validateAhrefsServiceAccount = tokenCheckValidator({
  serviceLabel: 'Ahrefs',
  request: ({ apiToken }) => ({
    url: 'https://api.ahrefs.com/v3/subscription-info/limits-and-usage',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
