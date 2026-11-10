import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** incident.io's identity endpoint describes the calling API key, so it answers 200 for any valid key and 401 otherwise. */
export const validateIncidentioServiceAccount = tokenCheckValidator({
  serviceLabel: 'incident.io',
  request: ({ apiToken }) => ({
    url: 'https://api.incident.io/v1/identity',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
