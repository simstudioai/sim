import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/slackLists.download.start/ */
export const slackListsDownloadStartTool = createSlackWebApiTool({
  id: 'slack_lists_download_start',
  name: 'Slack Start List Export',
  description:
    'Start an asynchronous CSV or JSON List export. Use the returned job_id with Get List Export and the same format options.',
  endpoint: 'slackLists.download.start',
  method: 'POST',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['lists:read'],
    credentialKind: 'service-account',
  },
  params: {
    list_id: { type: 'string', required: true, visibility: 'user-or-llm', description: 'List ID' },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Export Format Options: csv, json.',
    },
    include_threads: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include Threads',
    },
    include_attachments: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include Attachments',
    },
    include_archived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include Archived Rows',
    },
  },
  input: z
    .object({
      list_id: z.string().trim().min(1),
      format: z.enum(['csv', 'json']).optional(),
      include_threads: z.boolean().optional(),
      include_attachments: z.boolean().optional(),
      include_archived: z.boolean().optional(),
    })
    .refine(
      (p) => (!p.include_threads && !p.include_attachments) || p.format === 'json',
      'Threads and attachments require JSON export format'
    ),
  output: z.object({ ok: z.literal(true), job_id: z.string() }),
  outputs: {
    ok: { type: 'boolean', description: 'Ok' },
    job_id: { type: 'string', description: 'Job id' },
  },
})
