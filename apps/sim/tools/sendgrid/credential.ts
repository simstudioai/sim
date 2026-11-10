import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** SendGrid tools take an inline key or a saved SendGrid credential. */
export const SENDGRID_CREDENTIAL_OAUTH = tokenCredentialOAuth('sendgrid', { apiKey: 'accessToken' })
