import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/dnd.endDnd/ */
export const slackEndDndTool = createSlackWebApiTool({
  id: 'slack_end_dnd',
  name: 'Slack End Do Not Disturb',
  description: 'End the authorized Slack user’s current Do Not Disturb session.',
  endpoint: 'dnd.endDnd',
  method: 'POST',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['dnd:write'],
    credentialKind: 'oauth',
  },
  params: {},
  input: z.object({}),
  output: z.object({ ok: z.literal(true) }),
  outputs: { ok: { type: 'boolean', description: 'Ok' } },
})
