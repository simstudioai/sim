import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Smartlead tools take an inline key or a saved Smartlead credential. */
export const SMARTLEAD_CREDENTIAL_OAUTH = tokenCredentialOAuth('smartlead', {
  apiKey: 'accessToken',
})
