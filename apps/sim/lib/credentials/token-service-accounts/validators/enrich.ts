import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Enrich's credit-balance endpoint costs no credits and succeeds only for a valid key. */
export const validateEnrichServiceAccount = tokenCheckValidator({
  serviceLabel: 'Enrich',
  request: ({ apiToken }) => ({
    url: 'https://api.enrich.so/v1/api/auth',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
