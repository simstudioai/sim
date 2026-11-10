import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** AgentPhone tools take an inline key or a saved AgentPhone credential. */
export const AGENTPHONE_CREDENTIAL_OAUTH = tokenCredentialOAuth('agentphone', {
  apiKey: 'accessToken',
})
