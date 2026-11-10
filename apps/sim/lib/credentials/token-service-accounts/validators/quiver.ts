import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** QuiverAI's list-models endpoint answers 200 for a valid key and 401 otherwise. */
export const validateQuiverServiceAccount = tokenCheckValidator({
  serviceLabel: 'Quiver',
  request: ({ apiToken }) => ({
    url: 'https://api.quiver.ai/v1/models',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
