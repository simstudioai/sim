import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Listing one Rocketlane user answers 200 for a valid key and 401 otherwise. */
export const validateRocketlaneServiceAccount = tokenCheckValidator({
  serviceLabel: 'Rocketlane',
  request: ({ apiToken }) => ({
    url: 'https://api.rocketlane.com/api/1.0/users?pageSize=1',
    headers: { 'api-key': apiToken, Accept: 'application/json' },
  }),
})
