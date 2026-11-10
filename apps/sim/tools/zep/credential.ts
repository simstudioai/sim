import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Zep tools take an inline key or a saved Zep credential. */
export const ZEP_CREDENTIAL_OAUTH = tokenCredentialOAuth('zep', { apiKey: 'accessToken' })
