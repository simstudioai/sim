import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Quartr tools take an inline key or a saved Quartr credential. */
export const QUARTR_CREDENTIAL_OAUTH = tokenCredentialOAuth('quartr', { apiKey: 'accessToken' })
