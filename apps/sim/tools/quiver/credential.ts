import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Quiver tools take an inline key or a saved Quiver credential. */
export const QUIVER_CREDENTIAL_OAUTH = tokenCredentialOAuth('quiver', { apiKey: 'accessToken' })
