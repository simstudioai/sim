import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'
import { teamOutput, teamSchema } from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/team.info/ */
export const slackGetTeamInfoTool = createSlackWebApiTool({
  id: 'slack_get_team_info',
  name: 'Slack Get Workspace Info',
  description: 'Read a Slack workspace’s name, domain, icon, and available organization details.',
  endpoint: 'team.info',
  method: 'GET',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['team:read'],
    credentialKind: 'service-account',
  },
  params: {
    team: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Workspace ID',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Workspace Domain',
    },
  },
  input: z.object({
    team: z.string().trim().min(1).optional(),
    domain: z.string().trim().min(1).optional(),
  }),
  output: z.object({ ok: z.literal(true), team: teamSchema }),
  outputs: { ok: { type: 'boolean', description: 'Ok' }, team: { ...teamOutput } },
})
