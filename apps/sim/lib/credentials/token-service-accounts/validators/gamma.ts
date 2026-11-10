import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Gamma lists themes for a valid API key and answers 401 for a missing or bad one. */
export const validateGammaServiceAccount = tokenCheckValidator({
  serviceLabel: 'Gamma',
  request: ({ apiToken }) => ({
    url: 'https://public-api.gamma.app/v1.0/themes?limit=1',
    headers: { 'X-API-KEY': apiToken, Accept: 'application/json' },
  }),
})
