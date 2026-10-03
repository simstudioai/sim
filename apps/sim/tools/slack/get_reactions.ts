import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'
import {
  fileOutput,
  fileSchema,
  messageOutput,
  messageSchema,
  reactionOutput,
  reactionSchema,
} from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/reactions.get/ */
export const slackGetReactionsTool = createSlackWebApiTool({
  id: 'slack_get_reactions',
  name: 'Slack Get Reactions',
  description:
    'Get reactions for exactly one message, file, or file comment. Messages require both Channel ID and Message Timestamp.',
  endpoint: 'reactions.get',
  method: 'GET',
  oauth: { required: true, provider: 'slack', requiredScopes: ['reactions:read'] },
  params: {
    channel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Channel ID',
    },
    timestamp: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Message Timestamp',
    },
    file: { type: 'string', required: false, visibility: 'user-or-llm', description: 'File ID' },
    file_comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'File Comment ID',
    },
    full: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include All Reacting Users',
    },
  },
  input: z
    .object({
      channel: z.string().trim().min(1).optional(),
      timestamp: z.string().trim().min(1).optional(),
      file: z.string().trim().min(1).optional(),
      file_comment: z.string().trim().min(1).optional(),
      full: z.boolean().optional(),
    })
    .refine(
      (p) =>
        Number(p.channel !== undefined || p.timestamp !== undefined) +
          Number(p.file !== undefined) +
          Number(p.file_comment !== undefined) ===
          1 && (p.channel === undefined) === (p.timestamp === undefined),
      'Choose exactly one message (Channel ID and Timestamp), File ID, or File Comment ID'
    ),
  output: z.object({
    ok: z.literal(true),
    type: z.string(),
    channel: z.string().optional(),
    message: messageSchema.optional(),
    file: fileSchema.optional(),
    comment: z
      .object({
        id: z.string().optional(),
        comment: z.string().optional(),
        user: z.string().optional(),
        reactions: z.array(reactionSchema).optional(),
      })
      .passthrough()
      .optional(),
  }),
  outputs: {
    ok: { type: 'boolean', description: 'Ok' },
    type: { type: 'string', description: 'Type' },
    channel: { type: 'string', description: 'Channel', optional: true },
    message: { ...messageOutput, optional: true },
    file: { ...fileOutput, optional: true },
    comment: {
      type: 'object',
      description: 'Comment',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Id', optional: true },
        comment: { type: 'string', description: 'Comment', optional: true },
        user: { type: 'string', description: 'User', optional: true },
        reactions: {
          type: 'array',
          description: 'Reactions',
          optional: true,
          items: { ...reactionOutput },
        },
      },
    },
  },
})
