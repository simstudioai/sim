import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Linq tools take an inline key or a saved Linq credential. */
export const LINQ_CREDENTIAL_OAUTH = tokenCredentialOAuth('linq', { apiKey: 'accessToken' })
