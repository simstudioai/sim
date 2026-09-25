import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'
import { bookmarkOutput, bookmarkSchema } from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/bookmarks.add/ */
export const slackAddBookmarkTool = createSlackWebApiTool({
  id: 'slack_add_bookmark',
  name: 'Slack Add Bookmark',
  description: 'Add a link bookmark to a Slack channel.',
  endpoint: 'bookmarks.add',
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
    title: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Title' },
    link: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Link URL' },
    emoji: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Emoji' },
    parent_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parent Bookmark ID',
    },
  },
  input: z
    .object({
      channel_id: z.string().trim().min(1),
      title: z.string().trim().min(1),
      link: z.url().trim().min(1),
      emoji: z.string().optional(),
      parent_id: z.string().trim().min(1).optional(),
    })
    .transform((p) => ({ ...p, type: 'link' as const })),
  output: z.object({ ok: z.literal(true), bookmark: bookmarkSchema }),
  outputs: { ok: { type: 'boolean', description: 'Ok' }, bookmark: { ...bookmarkOutput } },
})
