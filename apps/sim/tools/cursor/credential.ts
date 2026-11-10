import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Cursor tools take an inline key or a saved Cursor credential. */
export const CURSOR_CREDENTIAL_OAUTH = tokenCredentialOAuth('cursor', { apiKey: 'accessToken' })
