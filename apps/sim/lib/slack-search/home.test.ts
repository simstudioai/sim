/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/connectors/registry', () => ({
  getConnectorMeta: (id: string) => (id === 'google_drive' ? { name: 'Google Drive' } : undefined),
}))

import {
  parseSlackSearchHomeEvent,
  renderSlackSearchHome,
  slackSearchHomeSource,
} from '@/lib/slack-search/home'

const now = 1_800_000_000_000
const event = {
  type: 'event_callback',
  api_app_id: 'A1',
  team_id: 'T1',
  event_id: 'Ev1',
  event_time: now / 1000,
  event: { type: 'app_home_opened', tab: 'home', user: 'U1' },
}
const source = {
  knowledgeBaseId: 'kb1',
  connectorId: 'source1',
  connectorType: 'google_drive',
  sourceDescription: '1 folder selected',
  accessMode: 'members' as const,
  availability: 'available' as const,
  enabled: true,
  approved: true,
  isSyncing: false,
  lastSyncAt: null,
  hasSyncError: false,
  viewerDocumentCount: 1,
  viewerFailedDocumentCount: 0,
  viewerEmailVerified: true,
  connectionRequired: true as const,
  viewerMembership: 'connected' as const,
}

describe('Slack Home events', () => {
  it('retains only the routing identity and concurrency hash', () => {
    expect(
      parseSlackSearchHomeEvent(
        {
          ...event,
          event: {
            ...event.event,
            view: { type: 'home', hash: 'h1', blocks: ['old private data'] },
          },
        },
        now
      )
    ).toEqual({
      appId: 'A1',
      teamId: 'T1',
      eventId: 'Ev1',
      userId: 'U1',
      viewHash: 'h1',
    })
  })
  it.each(['messages', 'about', undefined])('ignores the %s tab', (tab) => {
    expect(parseSlackSearchHomeEvent({ ...event, event: { ...event.event, tab } }, now)).toBeNull()
  })
  it.each([now - 301_000, now + 61_000])('ignores stale or future events: %s', (timestamp) => {
    expect(parseSlackSearchHomeEvent({ ...event, event_time: timestamp / 1000 }, now)).toBeNull()
  })
  it('rejects incomplete identity and unrelated events', () => {
    expect(parseSlackSearchHomeEvent({ ...event, team_id: '' }, now)).toBeNull()
    expect(
      parseSlackSearchHomeEvent({ ...event, event: { type: 'message', user: 'U1' } }, now)
    ).toBeNull()
  })
})

describe('personalized source statuses', () => {
  it('shows connected and syncing sources, with reconnect taking precedence', () => {
    expect(slackSearchHomeSource(source)?.status).toBe('Connected')
    expect(slackSearchHomeSource({ ...source, isSyncing: true })?.status).toBe('Syncing')
    expect(
      slackSearchHomeSource({ ...source, viewerMembership: 'needs_reauth', isSyncing: true })
        ?.status
    ).toBe('Reconnect needed')
  })
  it.each(['invited', 'not_enrolled', 'revoked', 'unverified_email', null] as const)(
    'does not list someone else’s connection for %s',
    (viewerMembership) => {
      expect(slackSearchHomeSource({ ...source, viewerMembership })).toBeNull()
    }
  )
  it('includes available shared sources that do not require individual connections', () => {
    expect(
      slackSearchHomeSource({
        ...source,
        accessMode: 'admin',
        connectionRequired: false,
        viewerMembership: null,
      })?.status
    ).toBe('Connected')
  })
  it('omits disabled, unavailable, and unapproved sources', () => {
    expect(slackSearchHomeSource({ ...source, enabled: false })).toBeNull()
    expect(slackSearchHomeSource({ ...source, approved: false })).toBeNull()
    expect(slackSearchHomeSource({ ...source, availability: 'unavailable' })).toBeNull()
  })
  it('does not mislabel a failed sync as expired authorization', () => {
    expect(slackSearchHomeSource({ ...source, hasSyncError: true })).toMatchObject({
      status: 'Connected',
      syncError: true,
    })
  })
})

describe('Slack Home presentation', () => {
  const sourcesUrl = 'https://sim.test/o/org1/integrations'
  it('renders a single URL button and compact source statuses as plain text', () => {
    const view = renderSlackSearchHome({
      sourcesUrl,
      sources: [slackSearchHomeSource(source)!],
      hasMore: false,
    })
    expect(view).toMatchObject({ type: 'home' })
    expect(JSON.stringify(view)).toContain('Google Drive — Connected')
    const blocks = view.blocks as Record<string, unknown>[]
    expect(blocks.filter((block) => block.type === 'actions')).toEqual([
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            action_id: 'sim_search.connect_sources',
            text: { type: 'plain_text', text: 'Connect sources' },
            style: 'primary',
            url: sourcesUrl,
          },
        ],
      },
    ])
    expect(JSON.stringify(view)).not.toContain('mrkdwn')
  })
  it('never renders source details for an unmatched account', () => {
    const view = renderSlackSearchHome({
      sourcesUrl,
      sources: [slackSearchHomeSource(source)!],
      hasMore: false,
      accountRequired: true,
    })
    expect(JSON.stringify(view)).toContain('Sign in to Sim')
    expect(JSON.stringify(view)).not.toContain('Google Drive')
  })
  it('caps provider content and source rows, including hostile labels', () => {
    const view = renderSlackSearchHome({
      sourcesUrl,
      sources: Array.from({ length: 200 }, () => ({
        name: '<!channel>',
        description: 'x'.repeat(4000),
        status: 'Connected',
        syncError: false,
      })),
      hasMore: true,
    })
    expect((view.blocks as unknown[]).length).toBe(25)
    expect(JSON.stringify(view)).not.toContain('x'.repeat(201))
    expect(JSON.stringify(view)).toContain('More sources are available')
  })
  it('explains empty connections and bounded sparse lists honestly', () => {
    expect(
      JSON.stringify(renderSlackSearchHome({ sourcesUrl, sources: [], hasMore: false }))
    ).toContain('No sources connected yet')
    expect(
      JSON.stringify(renderSlackSearchHome({ sourcesUrl, sources: [], hasMore: true }))
    ).not.toContain('No sources connected yet')
  })
})
