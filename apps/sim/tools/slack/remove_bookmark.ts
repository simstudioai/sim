import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'

/** https://docs.slack.dev/reference/methods/bookmarks.remove/ */
export const slackRemoveBookmarkTool = createSlackWebApiTool({
  id: 'slack_remove_bookmark',
  name: 'Slack Remove Bookmark',
  description: 'Remove a bookmark from a Slack channel.',
  endpoint: 'bookmarks.remove',
  method: 'POST',
  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['bookmarks:write'],
    credentialKind: 'service-account',
  },
  params: {
    channel_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Channel ID',
    },
    bookmark_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Bookmark ID',
    },
  },
  input: z.object({ channel_id: z.string().trim().min(1), bookmark_id: z.string().trim().min(1) }),
  output: z.object({ ok: z.literal(true) }),
  outputs: { ok: { type: 'boolean', description: 'Ok' } },
})
