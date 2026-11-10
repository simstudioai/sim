import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Enrich tools take an inline key or a saved Enrich credential. */
export const ENRICH_CREDENTIAL_OAUTH = tokenCredentialOAuth('enrich', { apiKey: 'accessToken' })
