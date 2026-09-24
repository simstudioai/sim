import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'
import { usergroupOutput, usergroupSchema } from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/usergroups.enable/ */
export const slackEnableUserGroupTool = createSlackWebApiTool({
  id: 'slack_enable_user_group',
  name: 'Slack Enable User Group',
  description: 'Reactivate a disabled Slack user group. Requires permission to manage user groups.',
  endpoint: 'usergroups.enable',
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
