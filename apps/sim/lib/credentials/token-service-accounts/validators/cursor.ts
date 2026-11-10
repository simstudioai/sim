import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Cursor's API key info endpoint answers 200 for a valid key and 401 otherwise. */
export const validateCursorServiceAccount = tokenCheckValidator({
  serviceLabel: 'Cursor',
  request: ({ apiToken }) => ({
    url: 'https://api.cursor.com/v0/me',
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiToken}:`).toString('base64')}`,
      Accept: 'application/json',
    },
  }),
})
