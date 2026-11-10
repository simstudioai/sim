import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Semrush's free API-units balance check answers 200 for a valid key and 400 otherwise. */
export const validateSemrushServiceAccount = tokenCheckValidator({
  serviceLabel: 'Semrush',
  request: ({ apiToken }) => ({
    url: `https://www.semrush.com/users/countapiunits.html?key=${encodeURIComponent(apiToken)}`,
    headers: { Accept: 'text/plain' },
  }),
})
