import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/users.setPresence/ */
export const slackSetUserPresenceTool = createSlackWebApiTool({
  id: 'slack_set_user_presence',
  name: 'Slack Set User Presence',
  description: 'Set the authenticated identity’s presence to away or automatic.',
  endpoint: 'users.setPresence',
  method: 'POST',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['users:write'],
    credentialKind: 'service-account',
  },
  params: {
    presence: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Presence Options: auto, away.',
    },
  },
  input: z.object({ presence: z.enum(['auto', 'away']) }),
  output: z.object({ ok: z.literal(true) }),
  outputs: { ok: { type: 'boolean', description: 'Ok' } },
})
