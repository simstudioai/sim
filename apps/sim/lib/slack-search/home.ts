import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SlackJsonObject } from '@/lib/internal/slack/client'

const id = z.string().min(1).max(200)
export const SLACK_SEARCH_HOME_MAX_AGE_MS = 5 * 60_000

const homeEventSchema = z.object({
  type: z.literal('event_callback'),
  api_app_id: id,
  team_id: id,
  event_id: id,
  event_time: z.number().int(),
  event: z.object({
    type: z.literal('app_home_opened'),
    tab: z.literal('home'),
    user: id,
    view: z
      .object({ type: z.literal('home'), hash: id, callback_id: z.string().max(255).optional() })
      .optional(),
  }),
})

const slackSearchHomeEventSchema = z.object({
  appId: id,
  teamId: id,
  eventId: id,
  userId: id,
  viewHash: id.optional(),
  viewKey: z.string().max(255).optional(),
})
export type SlackSearchHomeEvent = z.infer<typeof slackSearchHomeEventSchema>

/** Queue-only identity; no tokens, source data, or preauthorized Sim user IDs are persisted. */
export const slackSearchHomeJobSchema = z.object({
  installationId: id,
  revision: id,
  credentialId: id,
  credentialVersion: id,
  receivedAt: z.number().int().positive(),
  event: slackSearchHomeEventSchema,
})
export type SlackSearchHomeJob = z.infer<typeof slackSearchHomeJobSchema>

/** The Messages tab emits the same event; it must never trigger a Home publish or an answer. */
export function parseSlackSearchHomeEvent(
  body: unknown,
  now = Date.now()
): SlackSearchHomeEvent | null {
  const parsed = homeEventSchema.safeParse(body)
  if (!parsed.success) return null
  const { event, ...envelope } = parsed.data
  if (
    envelope.event_time * 1000 < now - SLACK_SEARCH_HOME_MAX_AGE_MS ||
    envelope.event_time * 1000 > now + 60_000
  )
    return null
  return {
    appId: envelope.api_app_id,
    teamId: envelope.team_id,
    eventId: envelope.event_id,
    userId: event.user,
    ...(event.view ? { viewHash: event.view.hash, viewKey: event.view.callback_id } : {}),
  }
}

/** Slack retains this marker with the view; reconnecting or changing the app origin invalidates it. */
export function slackSearchHomeViewKey(
  credentialId: string,
  credentialVersion: string,
  baseUrl: string
): string {
  const binding = createHash('sha256')
    .update(JSON.stringify([credentialId, credentialVersion, baseUrl]))
    .digest('hex')
  return `sim_search.connect_sources.v1:${binding}`
}

/** A persistent link to Sim; it carries no invitation, account details, or source status. */
export function renderSlackSearchHome(input: {
  sourcesUrl: string
  viewKey: string
}): SlackJsonObject {
  const blocks: SlackJsonObject[] = [
    { type: 'header', text: { type: 'plain_text', text: 'Connect your sources' } },
    {
      type: 'section',
      text: {
        type: 'plain_text',
        text: 'Connect more accounts in Sim to expand what you can search.',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: 'sim_search.connect_sources',
          text: { type: 'plain_text', text: 'Connect sources' },
          style: 'primary',
          url: input.sourcesUrl,
        },
      ],
    },
  ]
  return { type: 'home', callback_id: input.viewKey, blocks }
}
