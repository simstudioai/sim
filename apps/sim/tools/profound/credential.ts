import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Profound tools take an inline key or a saved Profound credential. */
export const PROFOUND_CREDENTIAL_OAUTH = tokenCredentialOAuth('profound', { apiKey: 'accessToken' })
