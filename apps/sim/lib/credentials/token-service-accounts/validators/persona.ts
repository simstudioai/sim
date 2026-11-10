import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Listing one inquiry answers 200 for a valid key with inquiry read access and 401 otherwise. */
export const validatePersonaServiceAccount = tokenCheckValidator({
  serviceLabel: 'Persona',
  request: ({ apiToken }) => ({
    url: 'https://api.withpersona.com/api/v1/inquiries?page%5Bsize%5D=1',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Persona-Version': '2025-12-08',
      Accept: 'application/json',
    },
  }),
})
