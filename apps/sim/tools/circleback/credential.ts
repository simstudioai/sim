import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Circleback tools take an inline key or a saved Circleback credential. */
export const CIRCLEBACK_CREDENTIAL_OAUTH = tokenCredentialOAuth('circleback', {
  apiKey: 'accessToken',
})
