import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Hex's list-projects endpoint (the one the Hex tools call) answers 200 for a valid token and 401 otherwise. */
export const validateHexServiceAccount = tokenCheckValidator({
  serviceLabel: 'Hex',
  request: ({ apiToken }) => ({
    url: 'https://app.hex.tech/api/v1/projects?limit=1',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
