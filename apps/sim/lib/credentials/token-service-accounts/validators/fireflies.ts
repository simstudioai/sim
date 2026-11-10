import { toArray, toRecord } from '@sim/utils/object'
import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/**
 * Fireflies' GraphQL `user` query returns the key owner for a valid key. A
 * rejected key comes back as HTTP 500 with an `auth_failed` error.
 */
export const validateFirefliesServiceAccount = tokenCheckValidator({
  serviceLabel: 'Fireflies',
  request: ({ apiToken }) => ({
    url: 'https://api.fireflies.ai/graphql',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query: '{ user { user_id } }' }),
  }),
  rejectsKey: (errorBody) =>
    toArray(toRecord(errorBody).errors).some((error) => toRecord(error).code === 'auth_failed'),
  acceptsBody: (body) => {
    if (typeof body !== 'object' || body === null || 'errors' in body) return false
    const data = (body as { data?: { user?: { user_id?: unknown } | null } | null }).data
    return typeof data?.user?.user_id === 'string'
  },
})
