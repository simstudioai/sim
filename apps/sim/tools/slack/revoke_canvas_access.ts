import { z } from 'zod'
import { createSlackWebApiTool, slackId, slackJson } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/canvases.access.delete/ */
export const slackRevokeCanvasAccessTool = createSlackWebApiTool({
  id: 'slack_revoke_canvas_access',
  name: 'Slack Revoke Canvas Access',
  description:
    'Remove user or regular-channel access to a standalone canvas. Channel-granted access must be revoked at the channel level.',
  endpoint: 'canvases.access.delete',
  method: 'POST',
  oauth: { required: true, provider: 'slack', requiredScopes: ['canvases:write'] },
  params: {
    canvas_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Canvas ID',
    },
    user_ids: { type: 'json', required: false, visibility: 'user-or-llm', description: 'User IDs' },
    channel_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Channel IDs',
    },
  },
  input: z
    .object({
      canvas_id: z.string().trim().min(1),
      user_ids: slackJson(z.array(slackId).min(1)).optional(),
      channel_ids: slackJson(z.array(slackId).min(1)).optional(),
    })
    .refine(
      (p) => p.user_ids !== undefined || p.channel_ids !== undefined,
      'Provide User IDs or Channel IDs'
    ),
  output: z.object({ ok: z.literal(true) }),
  outputs: { ok: { type: 'boolean', description: 'Ok' } },
})
