import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** LaunchDarkly tools take an inline key or a saved LaunchDarkly credential. */
export const LAUNCHDARKLY_CREDENTIAL_OAUTH = tokenCredentialOAuth('launchdarkly', {
  apiKey: 'accessToken',
})
