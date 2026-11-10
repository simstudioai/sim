import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Tailscale tools take an inline key or a saved Tailscale credential. */
export const TAILSCALE_CREDENTIAL_OAUTH = tokenCredentialOAuth('tailscale', {
  apiKey: 'accessToken',
})
