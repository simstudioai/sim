import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Apify tools take an inline key or a saved Apify credential. */
export const APIFY_CREDENTIAL_OAUTH = tokenCredentialOAuth('apify', { apiKey: 'accessToken' })
