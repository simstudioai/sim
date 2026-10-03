import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/dnd.info/ */
export const slackGetDndInfoTool = createSlackWebApiTool({
  id: 'slack_get_dnd_info',
  name: 'Slack Get Do Not Disturb Info',
  description: 'Read a user’s Do Not Disturb schedule and available snooze information.',
  endpoint: 'dnd.info',
  method: 'GET',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['dnd:read'],
    credentialKind: 'service-account',
  },
  params: {
    user: { type: 'string', required: false, visibility: 'user-or-llm', description: 'User ID' },
    team_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Workspace ID',
    },
  },
  input: z.object({
    user: z.string().trim().min(1).optional(),
    team_id: z.string().trim().min(1).optional(),
  }),
  output: z.object({
    ok: z.literal(true),
    dnd_enabled: z.boolean().optional(),
    next_dnd_start_ts: z.number().optional(),
    next_dnd_end_ts: z.number().optional(),
    snooze_enabled: z.boolean().optional(),
    snooze_endtime: z.number().optional(),
    snooze_remaining: z.number().optional(),
    snooze_is_indefinite: z.boolean().optional(),
  }),
  outputs: {
    ok: { type: 'boolean', description: 'Ok' },
    dnd_enabled: { type: 'boolean', description: 'Dnd enabled', optional: true },
    next_dnd_start_ts: { type: 'number', description: 'Next dnd start ts', optional: true },
    next_dnd_end_ts: { type: 'number', description: 'Next dnd end ts', optional: true },
    snooze_enabled: { type: 'boolean', description: 'Snooze enabled', optional: true },
    snooze_endtime: { type: 'number', description: 'Snooze endtime', optional: true },
    snooze_remaining: { type: 'number', description: 'Snooze remaining', optional: true },
    snooze_is_indefinite: { type: 'boolean', description: 'Snooze is indefinite', optional: true },
  },
})
