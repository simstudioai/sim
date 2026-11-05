/**
 * @vitest-environment node
 *
 * The widget state machine is what stands between a member and a dead Connect button or a false
 * "all caught up", and day positions are where a time-zone mistake would hide. Failure modes: an
 * organization that offers nothing reading as not connected, one bad account hiding the good ones,
 * a meeting placed by UTC rather than the viewer's clock, and a day's edge wrapping around.
 */
import { describe, expect, it } from 'vitest'
import type { MemberIntegration } from '@/lib/credential-groups/member-integrations'
import {
  HOME_EMAIL_SOURCES,
  settleReadAccounts,
  toCalendarDay,
  toHomeConnection,
} from '@/platform/lib/data/home-model'

function entry(id: string, overrides: Partial<MemberIntegration>): MemberIntegration {
  return {
    id,
    provider: id,
    name: id,
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
})

const connection = (entries: MemberIntegration[] | undefined, allowed = true) =>
  toHomeConnection({
    allowed,
    entries,
    failure: undefined,
    retrying: false,
    sources: HOME_EMAIL_SOURCES,
  })

describe('where a widget stands', () => {
  it('waits for the inventory rather than saying nothing is connected', () => {
    expect(connection(undefined).status).toBe('loading')
  })

  it('offers no Connect when the viewer has no integrations surface at all', () => {
    expect(connection([entry('source:gmail', {})], false).status).toBe('not_offered')
  })

  it('offers no Connect when the organization has not made the provider connectable', () => {
    expect(connection([]).status).toBe('not_offered')
    expect(connection([entry('source:gmail', { ready: false })]).status).toBe('not_offered')
    expect(connection([entry('source:gmail', { connectionTarget: undefined })]).status).toBe(
      'not_offered'
    )
  })

  it('offers only the providers the inventory marks connectable', () => {
    const state = connection([
      entry('source:gmail', { connectionTarget: { optionId: 'gmail-option' } }),
      entry('app:outlook', { ready: false }),
      entry('source:slack', { connectionTarget: { optionId: 'slack-option' } }),
    ])
    expect(state).toEqual({
      status: 'not_connected',
      options: [{ id: 'gmail-option', label: 'source:gmail', icon: 'I005' }],
    })
  })

  it('asks to reconnect only when no connected account can still be read', () => {
    const reauth = entry('source:gmail', {
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
        entry('app:outlook', { accounts: [account('b', 'active')], reconnectAccountIds: ['b'] }),
      ]).status
    ).toBe('connected')
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

  it('keeps an all-day event off the timeline without dropping it', () => {
    const calendar = day([event(window.startAt, window.endAt, true)])
    expect(calendar.meetings).toEqual([])
    expect(calendar.allDay).toHaveLength(1)
  })
})
