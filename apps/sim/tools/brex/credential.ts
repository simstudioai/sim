import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Brex tools take an inline key or a saved Brex credential. */
export const BREX_CREDENTIAL_OAUTH = tokenCredentialOAuth('brex', { apiKey: 'accessToken' })
