import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Crunchbase tools take an inline key or a saved Crunchbase credential. */
export const CRUNCHBASE_CREDENTIAL_OAUTH = tokenCredentialOAuth('crunchbase', {
  apiKey: 'accessToken',
})
