import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'
import { profileOutput, profileSchema } from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/users.profile.get/ */
export const slackGetUserProfileTool = createSlackWebApiTool({
  id: 'slack_get_user_profile',
  name: 'Slack Get User Profile',
  description:
    'Read a Slack user’s profile, status, and custom fields. Omit User ID for the authenticated identity.',
  endpoint: 'users.profile.get',
  method: 'GET',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['users.profile:read'],
    credentialKind: 'service-account',
  },
  params: {
    user: { type: 'string', required: false, visibility: 'user-or-llm', description: 'User ID' },
    include_labels: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include Custom Field Labels',
    },
  },
  input: z.object({
    user: z.string().trim().min(1).optional(),
    include_labels: z.boolean().optional(),
  }),
  output: z.object({ ok: z.literal(true), profile: profileSchema }),
  outputs: { ok: { type: 'boolean', description: 'Ok' }, profile: { ...profileOutput } },
})
