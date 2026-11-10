import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Extend tools take an inline key or a saved Extend credential. */
export const EXTEND_CREDENTIAL_OAUTH = tokenCredentialOAuth('extend', { apiKey: 'accessToken' })
