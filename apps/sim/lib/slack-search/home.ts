import { truncate } from '@sim/utils/string'
import { z } from 'zod'
import type { SlackJsonObject } from '@/lib/internal/slack/client'
import type { listSearchSources } from '@/lib/knowledge/application/search-sources'
import { getConnectorMeta } from '@/connectors/registry'

const id = z.string().min(1).max(200)
export const SLACK_SEARCH_HOME_MAX_SOURCES = 20
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
    view: z.object({ type: z.literal('home'), hash: id }).optional(),
  }),
})

const slackSearchHomeEventSchema = z.object({
  appId: id,
  teamId: id,
  eventId: id,
  userId: id,
  viewHash: id.optional(),
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
    ...(event.view ? { viewHash: event.view.hash } : {}),
  }
}

type SearchSource = Awaited<ReturnType<typeof listSearchSources.execute>>['sources'][number]

export interface SlackSearchHomeSource {
  name: string
  description: string
  status: 'Connected' | 'Syncing' | 'Reconnect needed'
  syncError: boolean
}

/** Uses viewer membership, never another member's grant or a generic sync failure, for connection state. */
export function slackSearchHomeSource(source: SearchSource): SlackSearchHomeSource | null {
  if (!source.enabled || source.approved === false || source.availability !== 'available')
    return null
  if (
    source.connectionRequired &&
    source.viewerMembership !== 'connected' &&
    source.viewerMembership !== 'needs_reauth'
  )
    return null
  return {
    name: getConnectorMeta(source.connectorType)?.name ?? source.connectorType,
    description: source.sourceDescription,
    status:
      source.viewerMembership === 'needs_reauth'
        ? 'Reconnect needed'
        : source.isSyncing
          ? 'Syncing'
          : 'Connected',
    syncError: source.hasSyncError,
  }
}

/** Plain text source rows cannot turn provider labels into Slack mentions or attacker links. */
export function renderSlackSearchHome(input: {
  sourcesUrl: string
  sources: SlackSearchHomeSource[]
  hasMore: boolean
  accountRequired?: boolean
}): SlackJsonObject {
  const blocks: SlackJsonObject[] = [
    { type: 'header', text: { type: 'plain_text', text: 'Your sources' } },
    {
      type: 'section',
      text: {
        type: 'plain_text',
        text: input.accountRequired
          ? 'Sign in to Sim with your Slack email and join this organization to see your sources.'
          : 'Connect your tools to search them with Sim. Manage connections and sync details in Sim.',
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
    { type: 'divider' },
  ]
  if (!input.accountRequired) {
    for (const source of input.sources.slice(0, SLACK_SEARCH_HOME_MAX_SOURCES)) {
      blocks.push({
        type: 'section',
        text: {
          type: 'plain_text',
          text: `${truncate(source.name, 100)} — ${source.status}${source.description ? `\n${truncate(source.description, 200)}` : ''}${source.syncError && source.status === 'Connected' ? '\nSync needs attention. Open Sim for details.' : ''}`,
        },
      })
    }
    if (input.sources.length === 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'plain_text',
          text: input.hasMore
            ? 'Open Sim to view your sources and connect more tools.'
            : 'No sources connected yet. Connect a source to get started.',
        },
      })
    }
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'plain_text',
          text: input.hasMore
            ? 'More sources are available in Sim. Statuses refresh when you open this tab.'
            : 'Statuses refresh when you open this tab.',
        },
      ],
    })
  }
  return { type: 'home', blocks }
}
