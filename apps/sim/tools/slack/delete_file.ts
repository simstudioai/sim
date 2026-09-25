import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/files.delete/ */
export const slackDeleteFileTool = createSlackWebApiTool({
  id: 'slack_delete_file',
  name: 'Slack Delete File',
  description: 'Permanently delete a Slack file the authenticated identity is allowed to delete.',
  endpoint: 'files.delete',
  method: 'POST',
  oauth: { required: true, provider: 'slack', requiredScopes: ['files:write'] },
  params: {
    file: { type: 'string', required: true, visibility: 'user-or-llm', description: 'File ID' },
  },
  input: z.object({ file: z.string().trim().min(1) }),
  output: z.object({ ok: z.literal(true) }),
  outputs: { ok: { type: 'boolean', description: 'Ok' } },
})
