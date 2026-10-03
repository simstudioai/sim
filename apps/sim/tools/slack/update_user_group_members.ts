import { z } from 'zod'
import { createSlackWebApiTool, slackId, slackJson } from '@/tools/slack/web-api'
import { usergroupOutput, usergroupSchema } from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/usergroups.users.update/ */
export const slackUpdateUserGroupMembersTool = createSlackWebApiTool({
  id: 'slack_update_user_group_members',
  name: 'Slack Update User Group Members',
  description:
    'Replace all members of a Slack user group with the supplied user IDs. An empty list is not supported; disable the group instead.',
  endpoint: 'usergroups.users.update',
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
    users: { type: 'json', required: true, visibility: 'user-or-llm', description: 'User IDs' },
    additional_channels: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Additional Channel IDs',
    },
    is_shared: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Shared Section',
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
    users: slackJson(z.array(slackId).min(1)).transform((ids) => ids.join(',')),
    additional_channels: slackJson(z.array(slackId))
      .transform((ids) => ids.join(','))
      .optional(),
    is_shared: z.boolean().optional(),
    include_count: z.boolean().optional(),
    team_id: z.string().trim().min(1).optional(),
  }),
  output: z.object({ ok: z.literal(true), usergroup: usergroupSchema.optional() }),
  outputs: {
    ok: { type: 'boolean', description: 'Ok' },
    usergroup: { ...usergroupOutput, optional: true },
  },
})
