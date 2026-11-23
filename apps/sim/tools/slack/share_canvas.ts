import { z } from 'zod'
import { createSlackWebApiTool, slackId, slackIdList } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/canvases.access.set/ */
export const slackShareCanvasTool = createSlackWebApiTool({
  id: 'slack_share_canvas',
  name: 'Slack Share Canvas',
  description:
    'Change access for users or regular channels on a standalone canvas. For sharing, first send the canvas link in Slack to the target. Channel resource canvases cannot be changed this way.',
  endpoint: 'canvases.access.set',
  method: 'POST',
  oauth: { required: true, provider: 'slack', requiredScopes: ['canvases:write'] },
  params: {
    canvas_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Canvas ID',
    },
    access_level: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Access Level Options: read, write, owner.',
    },
    user_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Up to 20 Slack user IDs, as a JSON array or a comma-separated string. Omit channel_ids.',
    },
    channel_ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Up to 20 Slack channel IDs, as a JSON array or a comma-separated string. Omit user_ids.',
    },
  },
  input: z
    .object({
      canvas_id: z.string().trim().min(1),
      access_level: z.enum(['read', 'write', 'owner']),
      user_ids: slackIdList(z.array(slackId).min(1).max(20)).optional(),
      channel_ids: slackIdList(z.array(slackId).min(1).max(20)).optional(),
    })
    .refine(
      (p) => (p.user_ids !== undefined) !== (p.channel_ids !== undefined),
      'Provide exactly one of User IDs or Channel IDs'
    )
    .refine(
      (p) => p.access_level !== 'owner' || p.channel_ids === undefined,
      'Only users can own a canvas'
    ),
  output: z.object({ ok: z.literal(true) }),
  outputs: { ok: { type: 'boolean', description: 'Ok' } },
})
