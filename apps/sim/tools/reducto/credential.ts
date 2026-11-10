import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Reducto tools take an inline key or a saved Reducto credential. */
export const REDUCTO_CREDENTIAL_OAUTH = tokenCredentialOAuth('reducto', { apiKey: 'accessToken' })
