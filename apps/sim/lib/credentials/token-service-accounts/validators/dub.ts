import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/**
 * Dub's domain list answers 200 for a valid key, 401 for an unknown one, and a
 * JSON 403 for a restricted key without the domains scope.
 */
export const validateDubServiceAccount = tokenCheckValidator({
  serviceLabel: 'Dub',
  request: ({ apiToken }) => ({
    url: 'https://api.dub.co/domains?pageSize=1',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
  forbiddenMeansScoped: true,
})
