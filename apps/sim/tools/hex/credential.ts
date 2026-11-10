import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Hex tools take an inline key or a saved Hex credential. */
export const HEX_CREDENTIAL_OAUTH = tokenCredentialOAuth('hex', { apiKey: 'accessToken' })
