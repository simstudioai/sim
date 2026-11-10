import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Mem0 tools take an inline key or a saved Mem0 credential. */
export const MEM0_CREDENTIAL_OAUTH = tokenCredentialOAuth('mem0', { apiKey: 'accessToken' })
