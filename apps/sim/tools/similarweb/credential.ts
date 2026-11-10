import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Similarweb tools take an inline key or a saved Similarweb credential. */
export const SIMILARWEB_CREDENTIAL_OAUTH = tokenCredentialOAuth('similarweb', {
  apiKey: 'accessToken',
})
