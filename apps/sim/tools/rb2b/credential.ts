import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** RB2B tools take an inline key or a saved RB2B credential. */
export const RB2B_CREDENTIAL_OAUTH = tokenCredentialOAuth('rb2b', { apiKey: 'accessToken' })
