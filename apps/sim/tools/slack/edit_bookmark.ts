import { z } from 'zod'
import { createSlackWebApiTool } from '@/tools/slack/web-api'
import { bookmarkOutput, bookmarkSchema } from '@/tools/slack/web-api-responses'

/** https://docs.slack.dev/reference/methods/bookmarks.edit/ */
export const slackEditBookmarkTool = createSlackWebApiTool({
  id: 'slack_edit_bookmark',
  name: 'Slack Edit Bookmark',
  description: 'Change a channel link bookmark’s title, URL, or emoji.',
  endpoint: 'bookmarks.edit',
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
    title: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Title' },
    link: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Link URL' },
    emoji: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Emoji' },
  },
  input: z
    .object({
      channel_id: z.string().trim().min(1),
      bookmark_id: z.string().trim().min(1),
      title: z.string().trim().min(1).optional(),
      link: z.url().trim().min(1).optional(),
      emoji: z.string().optional(),
    })
    .refine(
      (p) => p.title !== undefined || p.link !== undefined || p.emoji !== undefined,
      'Provide a title, link, or emoji to update'
    ),
  output: z.object({ ok: z.literal(true), bookmark: bookmarkSchema }),
  outputs: { ok: { type: 'boolean', description: 'Ok' }, bookmark: { ...bookmarkOutput } },
})
