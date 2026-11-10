import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Pulse tools take an inline key or a saved Pulse credential. */
export const PULSE_CREDENTIAL_OAUTH = tokenCredentialOAuth('pulse', { apiKey: 'accessToken' })
