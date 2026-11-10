import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Sixtyfour tools take an inline key or a saved Sixtyfour credential. */
export const SIXTYFOUR_CREDENTIAL_OAUTH = tokenCredentialOAuth('sixtyfour', {
  apiKey: 'accessToken',
})
