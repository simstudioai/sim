import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Persona tools take an inline key or a saved Persona credential. */
export const PERSONA_CREDENTIAL_OAUTH = tokenCredentialOAuth('persona', { apiKey: 'accessToken' })
