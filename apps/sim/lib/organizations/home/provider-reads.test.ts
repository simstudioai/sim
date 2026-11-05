/**
 * @vitest-environment node
 *
 * Failure modes owned here, because no other layer can see them: a provider status mapping to the
 * wrong widget state, a mail body entering the response, an unbounded field, and a Graph time read
 * in a zone Sim did not ask for.
 */
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HOME_CALENDAR_ATTENDEE_LIMIT,
  HOME_EMAIL_THREAD_LIMIT,
  HOME_TEXT_LIMITS,
} from '@/lib/organizations/home/limits'
import {
  HomeProviderReadError,
  readGmailThreads,
  readGoogleCalendarDay,
  readOutlookCalendarDay,
  readOutlookMessages,
} from '@/lib/organizations/home/provider-reads'
import { gmailThreadUrl } from '@/connectors/gmail/mailbox'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/connectors/gmail/mailbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/connectors/gmail/mailbox')>()),
  getGmailMailboxEmail: async () => 'reader@example.com',
}))

const { mockSecureFetchWithValidation: providerFetch } = inputValidationMockFns
const signal = new AbortController().signal
const window = { startAt: '2026-11-05T08:00:00.000Z', endAt: '2026-11-06T08:00:00.000Z' }

function respond(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body)
  return {
    ok: status < 400,
    status,
    statusText: '',
    headers: new Headers(headers),
    body: null,
    text: async () => text,
    json: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  }
}

function gmailThread(id: string, messages: Record<string, unknown>[]) {
  return {
    id,
    historyId: '1',
    messages: messages.map((message) => ({ id: `${id}-m`, ...message })),
  }
}

function metadataMessage(from: string, subject: string, snippet: string) {
  return {
    snippet,
    payload: {
      headers: [
        { name: 'From', value: from },
        { name: 'Subject', value: subject },
        { name: 'Date', value: 'Thu, 5 Nov 2026 10:00:00 +0000' },
      ],
    },
  }
}

beforeEach(() => {
  providerFetch.mockReset()
})

describe('provider status classification', () => {
  it.each([
    [401, {}, 'token_rejected'],
    [403, {}, 'needs_reauth'],
    [403, { 'retry-after': '30' }, 'unavailable'],
    [403, { 'x-ratelimit-remaining': '0' }, 'unavailable'],
    [429, {}, 'unavailable'],
    [500, {}, 'unavailable'],
  ])('reads %i %o as %s', async (status, headers, failure) => {
    providerFetch.mockResolvedValue(respond({ error: 'secret provider text' }, status, headers))
    const read = readOutlookMessages({ accessToken: 'token', signal })
    await expect(read).rejects.toBeInstanceOf(HomeProviderReadError)
    await expect(read).rejects.toMatchObject({ failure })
    await expect(read).rejects.not.toThrow(/secret provider text/)
  })
})

describe('reading mail', () => {
  it('asks Gmail for metadata only and never follows a redirect with the token', async () => {
    providerFetch.mockImplementation(async (url: string) =>
      url.includes('/threads?')
        ? respond({ threads: [{ id: 'thread-1' }] })
        : respond(
            gmailThread('thread-1', [
              metadataMessage('Ada Lovelace <ada@example.com>', 'Engines', 'Notes on engines'),
              metadataMessage('"Babbage, Charles" <cb@example.com>', 'Re: Engines', 'Agreed'),
            ])
          )
    )
    const threads = await readGmailThreads({ accessToken: 'token', signal })
    const threadUrl = new URL(providerFetch.mock.calls[1][0] as string)
    expect(threadUrl.searchParams.get('format')).toBe('metadata')
    expect(threadUrl.searchParams.getAll('metadataHeaders')).toEqual(['From', 'Subject', 'Date'])
    for (const [, options] of providerFetch.mock.calls) {
      expect(options).toMatchObject({ maxRedirects: 0, maxResponseBytes: expect.any(Number) })
    }
    expect(threads).toEqual([
      {
        id: 'thread-1',
        sender: 'Babbage, Charles',
        subject: 'Re: Engines',
        excerpt: 'Agreed',
        receivedAt: '2026-11-05T10:00:00.000Z',
        messageCount: 2,
        url: gmailThreadUrl('thread-1', 'reader@example.com'),
      },
    ])
  })

  it('bounds how many Gmail threads it reads and how long each field can be', async () => {
    const huge = 'x'.repeat(100_000)
    providerFetch.mockImplementation(async (url: string) =>
      url.includes('/threads?')
        ? respond({ threads: Array.from({ length: 40 }, (_, i) => ({ id: `t${i}` })) })
        : respond(gmailThread('t', [metadataMessage(huge, huge, huge)]))
    )
    const threads = await readGmailThreads({ accessToken: 'token', signal })
    expect(providerFetch).toHaveBeenCalledTimes(1 + HOME_EMAIL_THREAD_LIMIT)
    expect(threads).toHaveLength(HOME_EMAIL_THREAD_LIMIT)
    expect(threads[0].sender.length).toBeLessThanOrEqual(HOME_TEXT_LIMITS.name)
    expect(threads[0].subject.length).toBeLessThanOrEqual(HOME_TEXT_LIMITS.title)
    expect(threads[0].excerpt.length).toBeLessThanOrEqual(HOME_TEXT_LIMITS.excerpt)
  })

  it('keeps an Outlook preview and drops the message body Graph returned with it', async () => {
    providerFetch.mockResolvedValue(
      respond({
        value: [
          {
            id: 'AAM/k+1=',
            subject: 'Budget',
            bodyPreview: 'Short preview',
            body: { contentType: 'html', content: '<p>The whole confidential body</p>' },
            from: { emailAddress: { name: 'Grace', address: 'grace@example.com' } },
            receivedDateTime: '2026-11-05T09:00:00Z',
          },
        ],
      })
    )
    const [message] = await readOutlookMessages({ accessToken: 'token', signal })
    expect(JSON.stringify(message)).not.toContain('confidential')
    expect(
      new URL(providerFetch.mock.calls[0][0] as string).searchParams.get('$select')?.split(',')
    ).not.toContain('body')
    expect(message).toMatchObject({ sender: 'Grace', excerpt: 'Short preview' })
    expect(message.url).toBe('https://outlook.office.com/mail/inbox/id/AAM%2Fk%2B1%3D')
  })
})

describe('reading a calendar day', () => {
  it('asks Google for the primary calendar within the window and removes cancelled events', async () => {
    providerFetch.mockResolvedValue(
      respond({
        items: [
          {
            id: 'event-1',
            status: 'confirmed',
            summary: 'Review',
            htmlLink: 'https://calendar.google.com/event?eid=1',
            start: { dateTime: '2026-11-05T17:00:00Z' },
            end: { dateTime: '2026-11-05T17:30:00Z' },
            attendees: Array.from({ length: 30 }, (_, i) => ({ email: `p${i}@example.com` })),
          },
          {
            id: 'event-2',
            status: 'cancelled',
            start: { dateTime: '2026-11-05T18:00:00Z' },
            end: { dateTime: '2026-11-05T18:30:00Z' },
          },
          {
            id: 'event-3',
            status: 'confirmed',
            summary: 'Offsite',
            htmlLink: 'javascript:alert(1)',
            start: { date: '2026-11-05' },
            end: { date: '2026-11-06' },
          },
        ],
      })
    )
    const events = await readGoogleCalendarDay({ accessToken: 'token', signal, window })
    const url = new URL(providerFetch.mock.calls[0][0] as string)
    expect(url.pathname).toContain('/calendars/primary/events')
    expect(url.searchParams.get('timeMin')).toBe(window.startAt)
    expect(url.searchParams.get('timeMax')).toBe(window.endAt)
    expect(events.map((event) => event.id)).toEqual(['event-1', 'event-3'])
    expect(events[0].people).toHaveLength(HOME_CALENDAR_ATTENDEE_LIMIT)
    expect(events[1]).toMatchObject({ allDay: true, startAt: window.startAt, endAt: window.endAt })
    expect(events[1].url).toBeUndefined()
  })

  it('reads Graph’s UTC timestamps, refuses any other zone, and removes cancelled occurrences', async () => {
    providerFetch.mockResolvedValue(
      respond({
        value: [
          {
            id: 'graph-1',
            subject: 'Standup',
            start: { dateTime: '2026-11-05T17:00:00.0000000', timeZone: 'UTC' },
            end: { dateTime: '2026-11-05T17:15:00.0000000', timeZone: 'UTC' },
            webLink: 'https://outlook.office365.com/owa/?itemid=1',
          },
          {
            id: 'graph-2',
            isCancelled: true,
            subject: 'Canceled: Sync',
            start: { dateTime: '2026-11-05T18:00:00.0000000', timeZone: 'UTC' },
            end: { dateTime: '2026-11-05T18:15:00.0000000', timeZone: 'UTC' },
          },
          {
            id: 'graph-3',
            subject: 'Elsewhere',
            start: { dateTime: '2026-11-05T17:00:00.0000000', timeZone: 'Pacific Standard Time' },
            end: { dateTime: '2026-11-05T17:15:00.0000000', timeZone: 'Pacific Standard Time' },
          },
        ],
      })
    )
    const events = await readOutlookCalendarDay({ accessToken: 'token', signal, window })
    expect(events).toEqual([
      expect.objectContaining({
        id: 'graph-1',
        startAt: '2026-11-05T17:00:00.000Z',
        endAt: '2026-11-05T17:15:00.000Z',
      }),
    ])
  })
})
