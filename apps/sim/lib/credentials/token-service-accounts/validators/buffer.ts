import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Buffer's GraphQL account query answers 200 for a valid key and 401 otherwise. */
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
})
