import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Mem0's ping endpoint (the one its SDK calls on startup) answers 200 for a valid key and 401 otherwise. */
export const validateMem0ServiceAccount = tokenCheckValidator({
  serviceLabel: 'Mem0',
  request: ({ apiToken }) => ({
    url: 'https://api.mem0.ai/v1/ping/',
    headers: { Authorization: `Token ${apiToken}`, Accept: 'application/json' },
  }),
})
