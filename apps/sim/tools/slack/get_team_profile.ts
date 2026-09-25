import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'
import { teamProfileOutput, teamProfileSchema } from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/team.profile.get/ */
export const slackGetTeamProfileTool = createSlackWebApiTool({
  id: 'slack_get_team_profile',
  name: 'Slack Get Workspace Profile Fields',
  description:
    'Read the workspace’s custom profile field definitions, optionally filtered by visibility.',
  endpoint: 'team.profile.get',
  method: 'GET',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['users.profile:read'],
    credentialKind: 'service-account',
  },
  params: {
    visibility: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Visibility Options: all, visible, hidden.',
    },
  },
  input: z.object({ visibility: z.enum(['all', 'visible', 'hidden']).optional() }),
  output: z.object({ ok: z.literal(true), profile: teamProfileSchema }),
  outputs: { ok: { type: 'boolean', description: 'Ok' }, profile: { ...teamProfileOutput } },
})
