/**
 * @vitest-environment node
 *
 * The widget state machine is what stands between a member and a dead Connect button or a false
 * "all caught up", and day positions are where a time-zone mistake would hide. Failure modes: an
 * organization that offers nothing reading as not connected, one bad account hiding the good ones,
 * a meeting placed by UTC rather than the viewer's clock, and a day's edge wrapping around.
 */
import { describe, expect, it } from 'vitest'
import type { SearchIntegrationStatus } from '@/lib/api/contracts/knowledge/search-integrations'
import type { MemberIntegration } from '@/lib/credential-groups/member-integrations'
import type { CredentialGroupProvider } from '@/lib/credential-groups/providers'
import { defaultLiveSearchPolicy, type LiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import {
  HOME_EMAIL_SOURCES,
  settleReadAccounts,
  toCalendarDay,
  toHomeConnection,
  toReadableProviders,
  toRecentItems,
} from '@/platform/lib/data/home-model'

function entry(provider: string, overrides: Partial<MemberIntegration>): MemberIntegration {
  return {
    id: provider,
    provider,
    name: provider,
    icon: () => null,
    accounts: [],
    permissionAccountIds: [],
    reconnectAccountIds: [],
    ready: true,
    ...overrides,
  }
}

const account = (credentialId: string, status: 'active' | 'needs_reauth') => ({
  credentialId,
  displayName: `${credentialId}@example.com`,
  providerId: 'google-email',
  groupId: 'group',
  optionId: 'option',
  status,
  sites: [],
})

const connection = (
  entries: MemberIntegration[] | undefined,
  allowed = true,
  readableProviders: CredentialGroupProvider[] = ['gmail', 'outlook']
) =>
  toHomeConnection({
    allowed,
    entries,
    readableProviders,
    failure: undefined,
    retrying: false,
    sources: HOME_EMAIL_SOURCES,
  })

describe('where a widget stands', () => {
  it('waits for the inventory rather than saying nothing is connected', () => {
    expect(connection(undefined).status).toBe('loading')
  })

  it('offers no Connect when the viewer has no integrations surface at all', () => {
    expect(
      connection([entry('gmail', { connectionTarget: { optionId: 'gmail-option' } })], false).status
    ).toBe('not_offered')
  })

  it('offers no Connect when the organization has not made the provider connectable', () => {
    expect(connection([]).status).toBe('not_offered')
    expect(
      connection([entry('gmail', { ready: false, connectionTarget: { optionId: 'gmail-option' } })])
        .status
    ).toBe('not_offered')
    expect(connection([entry('gmail', {})]).status).toBe('not_offered')
  })

  it('offers only the providers the inventory marks connectable', () => {
    const state = connection([
      entry('gmail', { connectionTarget: { optionId: 'gmail-option' } }),
      entry('outlook', { ready: false, connectionTarget: { optionId: 'outlook-option' } }),
      entry('slack', { connectionTarget: { optionId: 'slack-option' } }),
    ])
    expect(state).toMatchObject({
      status: 'not_connected',
      options: [{ id: 'gmail-option', label: 'gmail' }],
    })
  })

  it('offers no Connect for a provider the viewer’s permission group cannot read', () => {
    const inventory = [entry('gmail', { connectionTarget: { optionId: 'gmail-option' } })]
    expect(connection(inventory, true, ['slack']).status).toBe('not_offered')
  })

  it('shows nothing connected on a provider the viewer’s permission group cannot read', () => {
    const reauth = entry('gmail', {
      accounts: [account('a', 'needs_reauth')],
      reconnectAccountIds: ['a'],
    })
    expect(connection([reauth], true, ['slack']).status).toBe('not_offered')
  })

  it('offers a readable provider beside one the permission group took away', () => {
    const state = connection(
      [
        entry('outlook', { accounts: [account('a', 'active')], reconnectAccountIds: ['a'] }),
        entry('gmail', { connectionTarget: { optionId: 'gmail-option' } }),
      ],
      true,
      ['gmail']
    )
    expect(state).toMatchObject({ status: 'not_connected', options: [{ id: 'gmail-option' }] })
  })

  it('leads with Google and keeps an approved Outlook as the second choice', () => {
    const state = connection([
      entry('outlook', { connectionTarget: { optionId: 'outlook-option' } }),
      entry('gmail', { connectionTarget: { optionId: 'gmail-option' } }),
    ])
    expect(state.status === 'not_connected' && state.options.map(({ id }) => id)).toEqual([
      'gmail-option',
      'outlook-option',
    ])
  })

  it('asks to reconnect only when no connected account can still be read', () => {
    const reauth = entry('gmail', {
      accounts: [account('a', 'needs_reauth')],
      reconnectAccountIds: ['a'],
    })
    expect(connection([reauth])).toMatchObject({
      status: 'needs_reauth',
      accounts: [{ id: 'a', canReconnect: true, problem: 'needs_reauth' }],
    })
    expect(
      connection([
        reauth,
        entry('outlook', { accounts: [account('b', 'active')], reconnectAccountIds: ['b'] }),
      ]).status
    ).toBe('connected')
  })
})

describe('which providers a widget can read', () => {
  const status = (connectorType: string, policy: Partial<LiveSearchPolicy>) =>
    ({
      connectorType,
      policy: { ...defaultLiveSearchPolicy(connectorType), ...policy },
    }) as SearchIntegrationStatus

  it('keeps a provider whose source has no content boundary', () => {
    expect(toReadableProviders(['gmail', 'slack'], [status('gmail', {})])).toEqual([
      'gmail',
      'slack',
    ])
  })

  it('drops a provider whose source restricts content, which a direct read would sidestep', () => {
    expect(
      toReadableProviders(['gmail', 'outlook'], [status('gmail', { excludePromotions: true })])
    ).toEqual(['outlook'])
  })
})

describe('settling a read', () => {
  const view = (id: string, problem?: 'needs_reauth' | 'unavailable' | 'not_offered') => ({
    id,
    label: id,
    canReconnect: true,
    problem,
  })

  it('keeps the list when any account answered', () => {
    expect(settleReadAccounts([view('a'), view('b', 'unavailable')])).toBeNull()
  })

  it('tells a withdrawn provider apart from a failing one', () => {
    expect(settleReadAccounts([view('a', 'not_offered')])?.status).toBe('not_offered')
    expect(settleReadAccounts([view('a', 'unavailable')])?.status).toBe('error')
    expect(settleReadAccounts([view('a', 'needs_reauth'), view('b', 'unavailable')])).toMatchObject(
      { status: 'needs_reauth', accounts: [{ id: 'a' }] }
    )
  })
})

describe('placing a meeting on the day', () => {
  const window = { startAt: '2026-11-05T08:00:00.000Z', endAt: '2026-11-06T08:00:00.000Z' }
  const event = (startAt: string, endAt: string, allDay = false) => ({
    id: 'e',
    credentialId: 'c',
    title: 'Review',
    allDay,
    startAt,
    endAt,
    people: [],
  })
  const day = (events: ReturnType<typeof event>[]) =>
    toCalendarDay(
      { accounts: [], window, events },
      { date: '2026-11-05', nowMinute: null, timeZone: 'America/Los_Angeles' }
    )

  it('reads the viewer’s clock, not UTC', () => {
    const [meeting] = day([event('2026-11-05T17:00:00.000Z', '2026-11-05T17:30:00.000Z')]).meetings
    expect(meeting).toMatchObject({ startMinute: 9 * 60, duration: 30 })
  })

  it('clamps a meeting running across midnight to the day on screen', () => {
    const [before] = day([event('2026-11-05T06:00:00.000Z', '2026-11-05T09:00:00.000Z')]).meetings
    expect(before).toMatchObject({ startMinute: 0, duration: 60 })
    const [after] = day([event('2026-11-06T07:00:00.000Z', '2026-11-06T10:00:00.000Z')]).meetings
    expect(after).toMatchObject({ startMinute: 23 * 60, duration: 60 })
  })

  it('keeps the true clock of a meeting cut off by midnight, for its label', () => {
    const [before] = day([event('2026-11-05T06:00:00.000Z', '2026-11-05T09:00:00.000Z')]).meetings
    expect(before?.clock).toEqual({ startMinute: 22 * 60, endMinute: 60 })
    const [within] = day([event('2026-11-05T17:00:00.000Z', '2026-11-05T17:30:00.000Z')]).meetings
    expect(within?.clock).toBeUndefined()
  })

  it('keeps a meeting with no length at zero, so its label does not invent a minute', () => {
    const [meeting] = day([event('2026-11-05T17:00:00.000Z', '2026-11-05T17:00:00.000Z')]).meetings
    expect(meeting?.duration).toBe(0)
  })

  it('keeps an all-day event off the timeline without dropping it', () => {
    const calendar = day([event(window.startAt, window.endAt, true)])
    expect(calendar.meetings).toEqual([])
    expect(calendar.allDay).toHaveLength(1)
  })

  it('moves a timed event filling the whole day out of the timeline', () => {
    const calendar = day([event(window.startAt, window.endAt)])
    expect(calendar.meetings).toEqual([])
    expect(calendar.allDay).toHaveLength(1)
  })
})

describe('toRecentItems', () => {
  const viewed = (url: string, title: string, connectorType?: string) => ({
    url,
    title,
    ...(connectorType ? { connectorType } : {}),
    viewedAt: '2026-11-05T10:00:00.000Z',
  })

  it('shows one chip for a channel, carrying every message it stands for', () => {
    const items = toRecentItems({
      sources: [
        viewed('https://acme.slack.com/archives/C1/p2', '#candidates', 'slack'),
        viewed('https://acme.slack.com/archives/C1/p1', '#candidates', 'slack'),
        viewed('https://a.example.com/x', 'Roadmap'),
      ],
      queries: [],
    })
    expect(items.map((item) => item.label)).toEqual(['#candidates', 'Roadmap'])
    expect(items[0].href).toBe('https://acme.slack.com/archives/C1/p2')
    expect(items[0].urls).toHaveLength(2)
  })

  it('leaves a source with no mark of its own bare, rather than the generic integration glyph', () => {
    const items = toRecentItems({
      sources: [viewed('https://a.example.com/x', 'Roadmap', 'no_such_connector')],
      queries: [],
    })
    expect(items[0]?.icon).toBeUndefined()
  })
})
