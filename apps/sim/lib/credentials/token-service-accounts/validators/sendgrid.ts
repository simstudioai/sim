import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** SendGrid's scopes endpoint lists the scopes of the key that calls it, so any valid key gets 200 and a bad one 401. */
export const validateSendGridServiceAccount = tokenCheckValidator({
  serviceLabel: 'SendGrid',
  request: ({ apiToken }) => ({
    url: 'https://api.sendgrid.com/v3/scopes',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
