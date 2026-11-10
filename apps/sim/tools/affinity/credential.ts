import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Affinity tools take an inline key or a saved Affinity credential. */
export const AFFINITY_CREDENTIAL_OAUTH = tokenCredentialOAuth('affinity', { apiKey: 'accessToken' })
