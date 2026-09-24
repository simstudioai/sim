import { z } from 'zod'
import { createSlackWebApiTool, slackId, slackJson } from '@/tools/slack/web-api'
import { usergroupOutput, usergroupSchema } from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/usergroups.update/ */
export const slackUpdateUserGroupTool = createSlackWebApiTool({
  id: 'slack_update_user_group',
  name: 'Slack Update User Group',
  description:
    'Change a Slack user group’s name, handle, description, or default channels. Requires permission to manage user groups.',
  endpoint: 'usergroups.update',
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
    name: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Name' },
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
  input: z
    .object({
      usergroup: z.string().trim().min(1),
      name: z.string().trim().min(1).optional(),
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
    })
    .refine(
      (p) =>
        [p.name, p.handle, p.description, p.channels, p.additional_channels, p.enable_section].some(
          (value) => value !== undefined
        ),
      'Provide at least one user group setting to update'
    ),
  output: z.object({ ok: z.literal(true), usergroup: usergroupSchema.optional() }),
  outputs: {
    ok: { type: 'boolean', description: 'Ok' },
    usergroup: { ...usergroupOutput, optional: true },
  },
})
