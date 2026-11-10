import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Cloudflare tools take an inline key or a saved Cloudflare credential. */
export const CLOUDFLARE_CREDENTIAL_OAUTH = tokenCredentialOAuth('cloudflare', {
  apiKey: 'accessToken',
})
