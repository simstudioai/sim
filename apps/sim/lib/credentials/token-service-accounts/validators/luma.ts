import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Luma's get-self endpoint returns the key's user, so it answers 200 for a valid key and 401 otherwise. */
export const validateLumaServiceAccount = tokenCheckValidator({
  serviceLabel: 'Luma',
  request: ({ apiToken }) => ({
    url: 'https://public-api.luma.com/v1/users/get-self',
    headers: { 'x-luma-api-key': apiToken, Accept: 'application/json' },
  }),
})
