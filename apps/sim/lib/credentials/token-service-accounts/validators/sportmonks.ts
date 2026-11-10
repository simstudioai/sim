import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Sportmonks' my/usage endpoint reads the token's own usage, so it succeeds only for a valid token. */
export const validateSportmonksServiceAccount = tokenCheckValidator({
  serviceLabel: 'Sportmonks',
  request: ({ apiToken }) => ({
    url: 'https://api.sportmonks.com/v3/my/usage?per_page=1',
    headers: { Authorization: apiToken, Accept: 'application/json' },
  }),
})
