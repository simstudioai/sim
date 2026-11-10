import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Rippling's current-user endpoint answers 200 for a valid token with the sso-me.read scope and 401 otherwise. */
export const validateRipplingServiceAccount = tokenCheckValidator({
  serviceLabel: 'Rippling',
  request: ({ apiToken }) => ({
    url: 'https://rest.ripplingapis.com/sso-me/',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
