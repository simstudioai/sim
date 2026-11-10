import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** AgentMail tools take an inline key or a saved AgentMail credential. */
export const AGENTMAIL_CREDENTIAL_OAUTH = tokenCredentialOAuth('agentmail', {
  apiKey: 'accessToken',
})
