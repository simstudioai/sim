import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Gamma tools take an inline key or a saved Gamma credential. */
export const GAMMA_CREDENTIAL_OAUTH = tokenCredentialOAuth('gamma', { apiKey: 'accessToken' })
