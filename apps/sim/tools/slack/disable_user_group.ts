import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'
import { usergroupOutput, usergroupSchema } from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/usergroups.disable/ */
export const slackDisableUserGroupTool = createSlackWebApiTool({
  id: 'slack_disable_user_group',
  name: 'Slack Disable User Group',
  description:
    'Disable a Slack user group and remove its members. Requires permission to manage user groups.',
  endpoint: 'usergroups.disable',
  method: 'POST',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['usergroups:write'],
    credentialKind: 'service-account',
  },
  params: {
    usergroup: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User Group ID',
    },
    include_count: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include Member Count',
    },
    team_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Workspace ID',
    },
  },
  input: z.object({
    usergroup: z.string().trim().min(1),
    include_count: z.boolean().optional(),
    team_id: z.string().trim().min(1).optional(),
  }),
  output: z.object({ ok: z.literal(true), usergroup: usergroupSchema.optional() }),
  outputs: {
    ok: { type: 'boolean', description: 'Ok' },
    usergroup: { ...usergroupOutput, optional: true },
  },
})
