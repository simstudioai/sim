import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Sixtyfour's balance endpoint answers 200 for a valid key and 401 for a missing or invalid one. */
export const validateSixtyfourServiceAccount = tokenCheckValidator({
  serviceLabel: 'Sixtyfour',
  request: ({ apiToken }) => ({
    url: 'https://api.sixtyfour.ai/check-balance',
    headers: { 'x-api-key': apiToken, Accept: 'application/json' },
  }),
})
