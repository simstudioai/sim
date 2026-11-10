import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Extend's file list, on the API version the parser uses, answers 200 for a valid key and 401 otherwise. */
export const validateExtendServiceAccount = tokenCheckValidator({
  serviceLabel: 'Extend',
  request: ({ apiToken }) => ({
    url: 'https://api.extend.ai/files?maxPageSize=1',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'x-extend-api-version': '2025-04-21',
      Accept: 'application/json',
    },
  }),
})
