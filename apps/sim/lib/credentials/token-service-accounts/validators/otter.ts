import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Otter's workspace endpoint answers 200 for a valid key and 401 otherwise. */
export const validateOtterServiceAccount = tokenCheckValidator({
  serviceLabel: 'Otter.ai',
  request: ({ apiToken }) => ({
    url: 'https://api.otter.ai/v1/workspace',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
