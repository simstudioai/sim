import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Pulse's usage endpoint reads the key's organization for free: 200 for a valid key, 401 otherwise. */
export const validatePulseServiceAccount = tokenCheckValidator({
  serviceLabel: 'Pulse',
  request: ({ apiToken }) => ({
    url: 'https://api.runpulse.com/usage',
    headers: { 'x-api-key': apiToken, Accept: 'application/json' },
  }),
})
