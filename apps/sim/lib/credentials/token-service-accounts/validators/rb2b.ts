import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** RB2B's credit balance endpoint answers 200 for a valid key and 401 otherwise. */
export const validateRB2BServiceAccount = tokenCheckValidator({
  serviceLabel: 'RB2B',
  request: ({ apiToken }) => ({
    url: 'https://api.rb2b.com/api/v1/credits',
    headers: { 'Api-Key': apiToken, Accept: 'application/json' },
  }),
})
