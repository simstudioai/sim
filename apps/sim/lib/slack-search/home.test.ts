/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  parseSlackSearchHomeEvent,
  renderSlackSearchHome,
  slackSearchHomeViewKey,
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

describe('Slack Home events', () => {
  it('retains routing identity, the published marker, and concurrency hash without the old content', () => {
    expect(
      parseSlackSearchHomeEvent(
        {
          ...event,
          event: {
            ...event.event,
            view: {
              type: 'home',
              hash: 'h1',
              callback_id: 'view-key',
              blocks: ['old private data'],
            },
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
      viewKey: 'view-key',
    })
  })
  it('accepts first visits and legacy views without a marker', () => {
    expect(parseSlackSearchHomeEvent(event, now)?.viewKey).toBeUndefined()
    expect(
      parseSlackSearchHomeEvent(
        { ...event, event: { ...event.event, view: { type: 'home', hash: 'h1' } } },
        now
      )
    ).toMatchObject({ userId: 'U1', viewHash: 'h1' })
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

describe('persistent Home view', () => {
  it('uses a stable opaque marker and invalidates it when the binding or origin changes', () => {
    const key = slackSearchHomeViewKey('c1', 'v1', 'https://sim.test')
    expect(key).toBe(slackSearchHomeViewKey('c1', 'v1', 'https://sim.test'))
    for (const changed of [
      slackSearchHomeViewKey('c2', 'v1', 'https://sim.test'),
      slackSearchHomeViewKey('c1', 'v2', 'https://sim.test'),
      slackSearchHomeViewKey('c1', 'v1', 'https://other.test'),
    ])
      expect(changed).not.toBe(key)
    expect(key).toMatch(/^sim_search\.connect_sources\.v1:[a-f0-9]{64}$/)
  })
  it('publishes static copy and a stable URL button with no invitation or status data', () => {
    const sourcesUrl = 'https://sim.test/o/org1/integrations'
    const viewKey = slackSearchHomeViewKey('c1', 'v1', 'https://sim.test')
    expect(renderSlackSearchHome({ sourcesUrl, viewKey })).toEqual({
      type: 'home',
      callback_id: viewKey,
      blocks: [
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
              url: sourcesUrl,
            },
          ],
        },
      ],
    })
  })
})
