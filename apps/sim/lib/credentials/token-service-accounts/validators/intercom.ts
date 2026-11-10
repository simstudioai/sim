import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/**
 * Intercom's identify-admin endpoint answers 200 with the token's admin, 401 to an unknown
 * token, and a JSON 403 to a valid token missing the scope, which still proves the token.
 */
export const validateIntercomServiceAccount = tokenCheckValidator({
  serviceLabel: 'Intercom',
  request: ({ apiToken }) => ({
    url: 'https://api.intercom.io/me',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: 'application/json',
      'Intercom-Version': '2.14',
    },
  }),
  forbiddenMeansScoped: true,
})
