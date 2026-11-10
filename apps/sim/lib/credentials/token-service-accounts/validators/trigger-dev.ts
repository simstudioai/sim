import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Listing one run needs a valid environment secret key; Trigger.dev answers 401 for any other. */
export const validateTriggerDevServiceAccount = tokenCheckValidator({
  serviceLabel: 'Trigger.dev',
  request: ({ apiToken }) => ({
    url: 'https://api.trigger.dev/api/v1/runs?page%5Bsize%5D=1',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
