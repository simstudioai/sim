import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Daytona describes the calling API key only when it is valid, with no extra permission. */
export const validateDaytonaServiceAccount = tokenCheckValidator({
  serviceLabel: 'Daytona',
  request: ({ apiToken }) => ({
    url: 'https://app.daytona.io/api/api-keys/current',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
