import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Fireflies tools take an inline key or a saved Fireflies credential. */
export const FIREFLIES_CREDENTIAL_OAUTH = tokenCredentialOAuth('fireflies', {
  apiKey: 'accessToken',
})
