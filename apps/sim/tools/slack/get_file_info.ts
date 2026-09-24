import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'
import {
  fileOutput,
  fileSchema,
  metadataOutput,
  metadataSchema,
  pagingOutput,
  pagingSchema,
} from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/files.info/ */
export const slackGetFileInfoTool = createSlackWebApiTool({
  id: 'slack_get_file_info',
  name: 'Slack Get File Info',
  description:
    'Read Slack file metadata and one page of legacy file comments. Continue with response_metadata.next_cursor.',
  endpoint: 'files.info',
  method: 'GET',
  oauth: { required: true, provider: 'slack', requiredScopes: ['files:read'] },
  params: {
    file: { type: 'string', required: true, visibility: 'user-or-llm', description: 'File ID' },
    cursor: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Cursor' },
    limit: { type: 'number', required: false, visibility: 'user-or-llm', description: 'Page Size' },
  },
  input: z.object({
    file: z.string().trim().min(1),
    cursor: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(999).optional(),
  }),
  output: z.object({
    ok: z.literal(true),
    file: fileSchema,
    comments: z
      .array(
        z
          .object({
            id: z.string(),
            comment: z.string().optional(),
            user: z.string().optional(),
            created: z.number().optional(),
            timestamp: z.number().optional(),
          })
          .passthrough()
      )
      .optional(),
    paging: pagingSchema.optional(),
    response_metadata: metadataSchema.optional(),
  }),
  outputs: {
    ok: { type: 'boolean', description: 'Ok' },
    file: { ...fileOutput },
    comments: {
      type: 'array',
      description: 'File comments, oldest first',
      optional: true,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Comment ID' },
          comment: { type: 'string', description: 'Comment text', optional: true },
          user: { type: 'string', description: 'Author ID', optional: true },
          created: { type: 'number', description: 'Creation timestamp', optional: true },
          timestamp: { type: 'number', description: 'Comment timestamp', optional: true },
        },
      },
    },
    paging: { ...pagingOutput, optional: true },
    response_metadata: { ...metadataOutput, optional: true },
  },
})
