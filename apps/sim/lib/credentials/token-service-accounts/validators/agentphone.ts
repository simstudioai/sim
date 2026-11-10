import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** AgentPhone's usage endpoint answers 200 for a valid key and 401 otherwise. */
export const validateAgentPhoneServiceAccount = tokenCheckValidator({
  serviceLabel: 'AgentPhone',
  request: ({ apiToken }) => ({
    url: 'https://api.agentphone.to/v1/usage',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
