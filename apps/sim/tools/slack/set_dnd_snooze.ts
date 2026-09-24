import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/dnd.setSnooze/ */
export const slackSetDndSnoozeTool = createSlackWebApiTool({
  id: 'slack_set_dnd_snooze',
  name: 'Slack Snooze Notifications',
  description: 'Snooze notifications for the authorized Slack user for a number of minutes.',
  endpoint: 'dnd.setSnooze',
  method: 'POST',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['dnd:write'],
    credentialKind: 'oauth',
  },
  params: {
    num_minutes: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Minutes',
    },
  },
  input: z.object({ num_minutes: z.number().int().min(1).transform(String) }),
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
