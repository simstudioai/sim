import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Square tools take an inline key or a saved Square credential. */
export const SQUARE_CREDENTIAL_OAUTH = tokenCredentialOAuth('square', { apiKey: 'accessToken' })
