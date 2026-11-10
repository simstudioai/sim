import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Browser Use tools take an inline key or a saved Browser Use credential. */
export const BROWSER_USE_CREDENTIAL_OAUTH = tokenCredentialOAuth('browser_use', {
  apiKey: 'accessToken',
})
