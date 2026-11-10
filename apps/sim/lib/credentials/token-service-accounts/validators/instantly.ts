import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Instantly's campaign list (the one the Instantly tools call) answers 200 for a valid key and 401 otherwise. */
export const validateInstantlyServiceAccount = tokenCheckValidator({
  serviceLabel: 'Instantly',
  request: ({ apiToken }) => ({
    url: 'https://api.instantly.ai/api/v2/campaigns?limit=1',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
