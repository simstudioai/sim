import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Intercom tools take an inline key or a saved Intercom credential. */
export const INTERCOM_CREDENTIAL_OAUTH = tokenCredentialOAuth('intercom', {
  accessToken: 'accessToken',
})
