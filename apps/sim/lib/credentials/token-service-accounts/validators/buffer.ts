import { toRecord } from '@sim/utils/object'
import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/**
 * Buffer's GraphQL API can report a rejected key as an `UNAUTHORIZED` error in
 * a 200 body, so the key is proven only when the account query returns an id.
 */
export const validateBufferServiceAccount = tokenCheckValidator({
  serviceLabel: 'Buffer',
  request: ({ apiToken }) => ({
    url: 'https://api.buffer.com',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query: 'query { account { id } }' }),
  }),
  acceptsBody: (body) => {
    const account = toRecord(toRecord(toRecord(body).data).account)
    return typeof account.id === 'string' && account.id.length > 0
  },
})
