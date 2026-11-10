import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Otter.ai tools take an inline key or a saved Otter.ai credential. */
export const OTTER_CREDENTIAL_OAUTH = tokenCredentialOAuth('otter', { apiKey: 'accessToken' })
