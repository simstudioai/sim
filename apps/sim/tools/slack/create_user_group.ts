import { z } from 'zod'
import { createSlackWebApiTool, slackId, slackJson } from '@/tools/slack/web-api'
import { usergroupOutput, usergroupSchema } from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/usergroups.create/ */
export const slackCreateUserGroupTool = createSlackWebApiTool({
  id: 'slack_create_user_group',
  name: 'Slack Create User Group',
  description:
    'Create a Slack user group with a mention handle and default channels. Requires a paid plan and permission to manage user groups.',
  endpoint: 'usergroups.create',
  method: 'POST',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['usergroups:write'],
    credentialKind: 'service-account',
  },
  params: {
    name: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Name' },
    handle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mention Handle',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description',
    },
    channels: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Default Channel IDs',
    },
    additional_channels: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Additional Channel IDs',
    },
    enable_section: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Show as Sidebar Section',
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
    name: z.string().trim().min(1),
    handle: z.string().trim().min(1).optional(),
    description: z.string().optional(),
    channels: slackJson(z.array(slackId))
      .transform((ids) => ids.join(','))
      .optional(),
    additional_channels: slackJson(z.array(slackId))
      .transform((ids) => ids.join(','))
      .optional(),
    enable_section: z.boolean().optional(),
    include_count: z.boolean().optional(),
    team_id: z.string().trim().min(1).optional(),
  }),
  output: z.object({ ok: z.literal(true), usergroup: usergroupSchema.optional() }),
  outputs: {
    ok: { type: 'boolean', description: 'Ok' },
    usergroup: { ...usergroupOutput, optional: true },
  },
})
