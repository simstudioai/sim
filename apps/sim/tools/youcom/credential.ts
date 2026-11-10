import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** You.com tools take an inline key or a saved You.com credential. */
export const YOUCOM_CREDENTIAL_OAUTH = tokenCredentialOAuth('youcom', { apiKey: 'accessToken' })
