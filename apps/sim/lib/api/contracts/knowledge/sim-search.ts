import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { SLACK_SEARCH_MAX_LIMIT } from '@/lib/slack-search/client'

export const MAX_SIM_SEARCH_SLACK_QUERY_LENGTH = 2000

export const slackSearchBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  query: z
    .string()
    .min(1, 'query cannot be empty')
    .max(
      MAX_SIM_SEARCH_SLACK_QUERY_LENGTH,
      `query cannot exceed ${MAX_SIM_SEARCH_SLACK_QUERY_LENGTH} characters`
    ),
  limit: z.number().int().min(1).max(SLACK_SEARCH_MAX_LIMIT).optional(),
})

export const slackSearchResultSchema = z.object({
  channelId: z.string(),
  messageTs: z.string(),
  channelName: z.string(),
  authorName: z.string(),
  text: z.string(),
  permalink: z.string().url(),
  /** ISO-8601, or null when Slack returned a timestamp that would not parse. */
  sentAt: z.string().nullable(),
})

/**
 * Whether Slack answered, and if not, what the person can do about it.
 * `needs_reauth` is its own state because reconnecting is a real action they
 * can take, where `unavailable` is nothing they can fix.
 */
export const slackSearchStatusSchema = z.enum([
  'ok',
  'not_connected',
  'needs_reauth',
  'unavailable',
])

/**
 * Searching Slack for the person asking, live, under their own Slack account.
 * Nothing is indexed and no result is stored, so this is a read that returns
 * exactly what that person could have found in Slack themselves.
 */
export const searchSimSearchSlackContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/sim-search/slack',
  body: slackSearchBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      data: z.object({
        status: slackSearchStatusSchema,
        results: z.array(slackSearchResultSchema),
      }),
    }),
  },
})

export type SearchSimSearchSlackBody = z.input<typeof slackSearchBodySchema>
export type SimSearchSlackResult = z.output<typeof slackSearchResultSchema>
export type SimSearchSlackStatus = z.output<typeof slackSearchStatusSchema>
