import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Brex's current-user endpoint answers 200 for a valid user token and 401 otherwise. */
export const validateBrexServiceAccount = tokenCheckValidator({
  serviceLabel: 'Brex',
  request: ({ apiToken }) => ({
    url: 'https://api.brex.com/v2/users/me',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
