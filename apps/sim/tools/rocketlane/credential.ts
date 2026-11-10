import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Rocketlane tools take an inline key or a saved Rocketlane credential. */
export const ROCKETLANE_CREDENTIAL_OAUTH = tokenCredentialOAuth('rocketlane', {
  apiKey: 'accessToken',
})
