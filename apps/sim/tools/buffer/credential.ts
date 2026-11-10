import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Buffer tools take an inline key or a saved Buffer credential. */
export const BUFFER_CREDENTIAL_OAUTH = tokenCredentialOAuth('buffer', { apiKey: 'accessToken' })
