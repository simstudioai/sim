import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Semrush tools take an inline key or a saved Semrush credential. */
export const SEMRUSH_CREDENTIAL_OAUTH = tokenCredentialOAuth('semrush', { apiKey: 'accessToken' })
