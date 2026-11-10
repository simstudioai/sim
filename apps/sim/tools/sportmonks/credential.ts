import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Sportmonks tools take an inline key or a saved Sportmonks credential. */
export const SPORTMONKS_CREDENTIAL_OAUTH = tokenCredentialOAuth('sportmonks', {
  apiKey: 'accessToken',
})
