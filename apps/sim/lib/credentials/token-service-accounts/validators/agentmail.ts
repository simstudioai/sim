import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Listing one AgentMail inbox answers 200 for a valid key and 403 otherwise. */
export const validateAgentMailServiceAccount = tokenCheckValidator({
  serviceLabel: 'AgentMail',
  request: ({ apiToken }) => ({
    url: 'https://api.agentmail.to/v0/inboxes?limit=1',
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  }),
})
