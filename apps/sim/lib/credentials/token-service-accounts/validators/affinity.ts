import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Affinity's whoami endpoint answers 200 for a valid key and 401 otherwise. */
export const validateAffinityServiceAccount = tokenCheckValidator({
  serviceLabel: 'Affinity',
  request: ({ apiToken }) => ({
    url: 'https://api.affinity.co/v2/auth/whoami',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
