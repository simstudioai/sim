import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Rippling tools take an inline key or a saved Rippling credential. */
export const RIPPLING_CREDENTIAL_OAUTH = tokenCredentialOAuth('rippling', { apiKey: 'accessToken' })
