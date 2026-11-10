import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** YouTube tools take an inline key or a saved YouTube credential. */
export const YOUTUBE_CREDENTIAL_OAUTH = tokenCredentialOAuth('youtube', { apiKey: 'accessToken' })
