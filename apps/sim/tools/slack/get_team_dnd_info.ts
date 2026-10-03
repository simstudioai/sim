import { z } from 'zod'
import { createSlackWebApiTool, slackId, slackJson } from '@/tools/slack/web-api'
import { dndSchema } from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/dnd.teamInfo/ */
export const slackGetTeamDndInfoTool = createSlackWebApiTool({
  id: 'slack_get_team_dnd_info',
  name: 'Slack Get Team Do Not Disturb Info',
  description: 'Read Do Not Disturb settings for the supplied user IDs.',
  endpoint: 'dnd.teamInfo',
  method: 'GET',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['dnd:read'],
    credentialKind: 'service-account',
  },
  params: {
    users: { type: 'json', required: true, visibility: 'user-or-llm', description: 'User IDs' },
    team_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Workspace ID',
    },
  },
  input: z.object({
    users: slackJson(z.array(slackId).min(1)).transform((ids) => ids.join(',')),
    team_id: z.string().trim().min(1).optional(),
  }),
  output: z.object({ ok: z.literal(true), users: z.record(z.string(), dndSchema) }),
  outputs: {
    ok: { type: 'boolean', description: 'Ok' },
    users: { type: 'json', description: 'Users' },
  },
})
