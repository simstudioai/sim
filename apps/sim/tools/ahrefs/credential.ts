import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Ahrefs tools take an inline key or a saved Ahrefs credential. */
export const AHREFS_CREDENTIAL_OAUTH = tokenCredentialOAuth('ahrefs', { apiKey: 'accessToken' })
