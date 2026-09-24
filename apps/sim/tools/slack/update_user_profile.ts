import { z } from 'zod'
import { createSlackWebApiTool, slackJson } from '@/tools/slack/web-api'
import { profileOutput, profileSchema } from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/users.profile.set/ */
export const slackUpdateUserProfileTool = createSlackWebApiTool({
  id: 'slack_update_user_profile',
  name: 'Slack Update User Profile',
  description:
    'Update a Slack user’s profile or status using a managed user credential. Updating another user requires Slack administrator permissions.',
  endpoint: 'users.profile.set',
  method: 'POST',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['users.profile:write'],
    credentialKind: 'oauth',
  },
  params: {
    profile: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON object of profile fields, including status_text, status_emoji, status_expiration, and custom fields. Empty status text and emoji clear the status.',
    },
    user: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Omit to update the authorized user. Updating others requires elevated Slack permissions.',
    },
  },
  input: z.object({
    profile: slackJson(
      z
        .object({
          title: z.string().optional(),
          phone: z.string().optional(),
          real_name: z.string().optional(),
          display_name: z.string().optional(),
          first_name: z.string().optional(),
          last_name: z.string().optional(),
          pronouns: z.string().optional(),
          email: z.string().optional(),
          start_date: z.string().optional(),
          status_text: z.string().optional(),
          status_emoji: z.string().optional(),
          status_expiration: z.number().int().min(0).optional(),
          fields: z
            .record(
              z.string().max(255),
              z.object({ value: z.string(), alt: z.string().max(256).optional() }).strict()
            )
            .optional(),
        })
        .strict()
        .refine((profile) => Object.keys(profile).length > 0, 'Provide at least one profile field')
    ),
    user: z.string().trim().min(1).optional(),
  }),
  output: z.object({ ok: z.literal(true), profile: profileSchema }),
  outputs: { ok: { type: 'boolean', description: 'Ok' }, profile: { ...profileOutput } },
})
