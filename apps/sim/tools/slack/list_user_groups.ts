import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'
import { usergroupOutput, usergroupSchema } from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/usergroups.list/ */
export const slackListUserGroupsTool = createSlackWebApiTool({
  id: 'slack_list_user_groups',
  name: 'Slack List User Groups',
  description:
    'Read Slack user groups, optionally including disabled groups, members, and member counts.',
  endpoint: 'usergroups.list',
  method: 'GET',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['usergroups:read'],
    credentialKind: 'service-account',
  },
  params: {
    include_disabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include Disabled Groups',
    },
    include_users: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include Members',
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
    include_disabled: z.boolean().optional(),
    include_users: z.boolean().optional(),
    include_count: z.boolean().optional(),
    team_id: z.string().trim().min(1).optional(),
  }),
  output: z.object({ ok: z.literal(true), usergroups: z.array(usergroupSchema) }),
  outputs: {
    ok: { type: 'boolean', description: 'Ok' },
    usergroups: { type: 'array', description: 'Usergroups', items: { ...usergroupOutput } },
  },
})
