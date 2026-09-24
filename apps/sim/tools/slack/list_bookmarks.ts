import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'
import { bookmarkOutput, bookmarkSchema } from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/bookmarks.list/ */
export const slackListBookmarksTool = createSlackWebApiTool({
  id: 'slack_list_bookmarks',
  name: 'Slack List Bookmarks',
  description: 'Read the bookmarks in a Slack channel.',
  endpoint: 'bookmarks.list',
  method: 'POST',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['bookmarks:read'],
    credentialKind: 'service-account',
  },
  params: {
    channel_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Channel ID',
    },
  },
  input: z.object({ channel_id: z.string().trim().min(1) }),
  output: z.object({ ok: z.literal(true), bookmarks: z.array(bookmarkSchema) }),
  outputs: {
    ok: { type: 'boolean', description: 'Ok' },
    bookmarks: { type: 'array', description: 'Bookmarks', items: { ...bookmarkOutput } },
  },
})
