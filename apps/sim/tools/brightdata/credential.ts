import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Bright Data tools take an inline key or a saved Bright Data credential. */
export const BRIGHTDATA_CREDENTIAL_OAUTH = tokenCredentialOAuth('brightdata', {
  apiKey: 'accessToken',
})
