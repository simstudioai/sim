import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** You.com's account balance read costs no credits and answers 200 only for a valid key. */
export const validateYouComServiceAccount = tokenCheckValidator({
  serviceLabel: 'You.com',
  request: ({ apiToken }) => ({
    url: 'https://api.you.com/v1/billing/account_balance',
    headers: { 'X-API-Key': apiToken, Accept: 'application/json' },
  }),
})
