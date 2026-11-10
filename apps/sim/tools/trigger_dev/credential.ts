import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Trigger.dev tools take an inline key or a saved Trigger.dev credential. */
export const TRIGGER_DEV_CREDENTIAL_OAUTH = tokenCredentialOAuth('trigger_dev', {
  apiKey: 'accessToken',
})
