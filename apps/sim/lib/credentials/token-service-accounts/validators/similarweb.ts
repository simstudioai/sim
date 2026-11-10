import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Similarweb's capabilities endpoint costs no data credits and answers 200 only for a valid key. */
export const validateSimilarwebServiceAccount = tokenCheckValidator({
  serviceLabel: 'Similarweb',
  request: ({ apiToken }) => ({
    url: `https://api.similarweb.com/capabilities?api_key=${encodeURIComponent(apiToken)}`,
    headers: { Accept: 'application/json' },
  }),
})
