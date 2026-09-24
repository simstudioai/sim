import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'
import { fileOutput, fileSchema, pagingOutput, pagingSchema } from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/files.list/ */
export const slackListFilesTool = createSlackWebApiTool({
  id: 'slack_list_files',
  name: 'Slack List Files',
  description:
    'List one page of Slack files matching user, channel, type, or timestamp filters. Continue using paging.page and paging.pages.',
  endpoint: 'files.list',
  method: 'GET',
  oauth: { required: true, provider: 'slack', requiredScopes: ['files:read'] },
  params: {
    channel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Channel ID',
    },
    user: { type: 'string', required: false, visibility: 'user-or-llm', description: 'User ID' },
    types: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'File Types',
    },
    ts_from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'From Timestamp',
    },
    ts_to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'To Timestamp',
    },
    page: { type: 'number', required: false, visibility: 'user-or-llm', description: 'Page' },
    count: { type: 'number', required: false, visibility: 'user-or-llm', description: 'Page Size' },
    show_files_hidden_by_limit: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include Files Hidden by Plan Limit',
    },
    team_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Workspace ID',
    },
  },
  input: z.object({
    channel: z.string().trim().min(1).optional(),
    user: z.string().trim().min(1).optional(),
    types: z.string().trim().min(1).optional(),
    ts_from: z.string().trim().min(1).optional(),
    ts_to: z.string().trim().min(1).optional(),
    page: z.number().int().min(1).optional(),
    count: z.number().int().min(1).max(100).optional(),
    show_files_hidden_by_limit: z.boolean().optional(),
    team_id: z.string().trim().min(1).optional(),
  }),
  output: z.object({
    ok: z.literal(true),
    files: z.array(fileSchema),
    paging: pagingSchema.optional(),
  }),
  outputs: {
    ok: { type: 'boolean', description: 'Ok' },
    files: { type: 'array', description: 'Files', items: { ...fileOutput } },
    paging: { ...pagingOutput, optional: true },
  },
})
