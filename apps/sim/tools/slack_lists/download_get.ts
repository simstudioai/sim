import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/slackLists.download.get/ */
export const slackListsDownloadGetTool = createSlackWebApiTool({
  id: 'slack_lists_download_get',
  name: 'Slack Get List Export',
  description:
    'Read a List export job status and its download URL when ready. Format, Include Threads, and Include Attachments must match Start List Export.',
  endpoint: 'slackLists.download.get',
  method: 'POST',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['lists:read'],
    credentialKind: 'service-account',
  },
  params: {
    list_id: { type: 'string', required: true, visibility: 'user-or-llm', description: 'List ID' },
    job_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Export Job ID',
    },
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
  },
  input: z
    .object({
      list_id: z.string().trim().min(1),
      job_id: z.string().trim().min(1),
      format: z.enum(['csv', 'json']).optional(),
      include_threads: z.boolean().optional(),
      include_attachments: z.boolean().optional(),
    })
    .refine(
      (p) => (!p.include_threads && !p.include_attachments) || p.format === 'json',
      'Threads and attachments require JSON export format'
    ),
  output: z.object({
    ok: z.literal(true),
    status: z.string(),
    download_url: z.string().optional(),
  }),
  outputs: {
    ok: { type: 'boolean', description: 'Ok' },
    status: { type: 'string', description: 'Status' },
    download_url: { type: 'string', description: 'Download url', optional: true },
  },
})
