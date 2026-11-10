import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Square's list-locations read answers 200 for a valid production access token and 401 otherwise. */
export const validateSquareServiceAccount = tokenCheckValidator({
  serviceLabel: 'Square',
  request: ({ apiToken }) => ({
    url: 'https://connect.squareup.com/v2/locations',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
