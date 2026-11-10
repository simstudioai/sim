import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Loops tools take an inline key or a saved Loops credential. */
export const LOOPS_CREDENTIAL_OAUTH = tokenCredentialOAuth('loops', { apiKey: 'accessToken' })
