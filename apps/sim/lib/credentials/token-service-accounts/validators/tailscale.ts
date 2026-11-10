import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Listing devices in the token's default tailnet (`-`) answers 200 for a valid token and 401 otherwise. */
export const validateTailscaleServiceAccount = tokenCheckValidator({
  serviceLabel: 'Tailscale',
  request: ({ apiToken }) => ({
    url: 'https://api.tailscale.com/api/v2/tailnet/-/devices',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
