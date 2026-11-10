import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Linq's phone-number list (the one the Linq tools call) answers 200 for a valid key and 401 otherwise. */
export const validateLinqServiceAccount = tokenCheckValidator({
  serviceLabel: 'Linq',
  request: ({ apiToken }) => ({
    url: 'https://api.linqapp.com/api/partner/v3/phone_numbers',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
