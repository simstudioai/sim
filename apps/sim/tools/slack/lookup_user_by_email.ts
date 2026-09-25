import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'
import { userOutput, userSchema } from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/users.lookupByEmail/ */
export const slackLookupUserByEmailTool = createSlackWebApiTool({
  id: 'slack_lookup_user_by_email',
  name: 'Slack Find User by Email',
  description: 'Find a Slack user by their email address.',
  endpoint: 'users.lookupByEmail',
  method: 'GET',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['users:read.email'],
    credentialKind: 'service-account',
  },
  params: {
    email: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Email' },
  },
  input: z.object({ email: z.email().trim().min(1) }),
  output: z.object({ ok: z.literal(true), user: userSchema }),
  outputs: { ok: { type: 'boolean', description: 'Ok' }, user: { ...userOutput } },
})
