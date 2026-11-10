import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Dub tools take an inline key or a saved Dub credential. */
export const DUB_CREDENTIAL_OAUTH = tokenCredentialOAuth('dub', { apiKey: 'accessToken' })
