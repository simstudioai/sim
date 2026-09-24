import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/usergroups.users.list/ */
export const slackListUserGroupMembersTool = createSlackWebApiTool({
  id: 'slack_list_user_group_members',
  name: 'Slack List User Group Members',
  description: 'Read the user IDs in a Slack user group.',
  endpoint: 'usergroups.users.list',
  method: 'GET',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['usergroups:read'],
    credentialKind: 'service-account',
  },
  params: {
    usergroup: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User Group ID',
    },
    include_disabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include Disabled Groups',
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
    include_disabled: z.boolean().optional(),
    team_id: z.string().trim().min(1).optional(),
  }),
  output: z.object({ ok: z.literal(true), users: z.array(z.string()) }),
  outputs: {
    ok: { type: 'boolean', description: 'Ok' },
    users: {
      type: 'array',
      description: 'Users',
      items: { type: 'string', description: 'Users item' },
    },
  },
})
