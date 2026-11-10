import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** LaunchDarkly's caller-identity endpoint describes the calling token, so it answers 200 for any valid token and 401 otherwise. */
export const validateLaunchdarklyServiceAccount = tokenCheckValidator({
  serviceLabel: 'LaunchDarkly',
  request: ({ apiToken }) => ({
    url: 'https://app.launchdarkly.com/api/v2/caller-identity',
    headers: { Authorization: apiToken, Accept: 'application/json' },
  }),
})
