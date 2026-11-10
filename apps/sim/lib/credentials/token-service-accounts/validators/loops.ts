import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Loops' API-key test endpoint answers 200 for a valid key and 401 otherwise. */
export const validateLoopsServiceAccount = tokenCheckValidator({
  serviceLabel: 'Loops',
  request: ({ apiToken }) => ({
    url: 'https://app.loops.so/api/v1/api-key',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
