import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Pinecone's list-indexes endpoint answers 200 for a valid key and 401 otherwise. */
export const validatePineconeServiceAccount = tokenCheckValidator({
  serviceLabel: 'Pinecone',
  request: ({ apiToken }) => ({
    url: 'https://api.pinecone.io/indexes',
    headers: {
      'Api-Key': apiToken,
      'X-Pinecone-API-Version': '2025-01',
      Accept: 'application/json',
    },
  }),
})
