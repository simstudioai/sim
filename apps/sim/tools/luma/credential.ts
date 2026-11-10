import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Luma tools take an inline key or a saved Luma credential. */
export const LUMA_CREDENTIAL_OAUTH = tokenCredentialOAuth('luma', { apiKey: 'accessToken' })
