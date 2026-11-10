import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Instantly tools take an inline key or a saved Instantly credential. */
export const INSTANTLY_CREDENTIAL_OAUTH = tokenCredentialOAuth('instantly', {
  apiKey: 'accessToken',
})
