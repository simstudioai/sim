import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Flint tools take an inline key or a saved Flint credential. */
export const FLINT_CREDENTIAL_OAUTH = tokenCredentialOAuth('flint', { apiKey: 'accessToken' })
