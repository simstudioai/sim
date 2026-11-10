import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Mailchimp tools take an inline key or a saved Mailchimp credential. */
export const MAILCHIMP_CREDENTIAL_OAUTH = tokenCredentialOAuth('mailchimp', {
  apiKey: 'accessToken',
})
