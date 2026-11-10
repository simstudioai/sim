import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Apollo tools take an inline key or a saved Apollo credential. */
export const APOLLO_CREDENTIAL_OAUTH = tokenCredentialOAuth('apollo', { apiKey: 'accessToken' })
