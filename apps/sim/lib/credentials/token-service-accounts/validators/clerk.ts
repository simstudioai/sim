import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Clerk's Backend API lists users only for a valid secret key and answers 401 otherwise. */
export const validateClerkServiceAccount = tokenCheckValidator({
  serviceLabel: 'Clerk',
  request: ({ apiToken }) => ({
    url: 'https://api.clerk.com/v1/users?limit=1',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
