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
import { compareStrings } from '@sim/utils/string'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HOME_CALENDAR_ATTENDEE_LIMIT,
  HOME_EMAIL_THREAD_LIMIT,
  HOME_TEXT_LIMITS,
} from '@/lib/organizations/home/limits'
import {
  type GmailThreadCursor,
  gmailThreadsStillNeeded,
  HomeProviderReadError,
  readGmailThreads as readGmailThreadsPage,
  readGoogleCalendarDay,
  readMoreGmailThreads,
  readOutlookCalendarDay,
  readOutlookMessages,
} from '@/lib/organizations/home/provider-reads'
import { gmailThreadUrl } from '@/connectors/gmail/mailbox'
import { GoogleApiError } from '@/connectors/google-workspace/api-errors'

const { mailboxEmail } = vi.hoisted(() => ({ mailboxEmail: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/connectors/gmail/mailbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/connectors/gmail/mailbox')>()),
  getGmailMailboxEmail: mailboxEmail,
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

let credentialCount = 0

/** A fresh credential each call, because the mailbox lookup is cached per credential. */
async function readGmailThreads(input: { accessToken: string; signal: AbortSignal }) {
  credentialCount += 1
  const { threads } = await readGmailThreadsPage({
    ...input,
    credentialId: `credential-${credentialCount}`,
    accountId: 'account',
    count: HOME_EMAIL_THREAD_LIMIT,
  })
  return threads
}

beforeEach(() => {
  mailboxEmail.mockReset()
  mailboxEmail.mockResolvedValue('reader@example.com')
  providerFetch.mockReset()
})

describe('provider status classification', () => {
  it('does not ask for a reconnect when Google reports quota in a 403 body', async () => {
    providerFetch.mockResolvedValue(
      respond({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, 403, {})
    )
    await expect(readOutlookMessages({ accessToken: 'token', signal })).rejects.toMatchObject({
      failure: 'unavailable',
    })
  })

  it.each([
    [401, [], 'token_rejected'],
    [403, ['insufficientPermissions'], 'needs_reauth'],
    [403, ['userRateLimitExceeded'], 'unavailable'],
    [500, [], 'unavailable'],
  ])('maps a %i mailbox lookup %o to %s', async (status, reasons, failure) => {
    providerFetch.mockResolvedValue(respond({ threads: [{ id: 'thread-1' }] }, 200, {}))
    mailboxEmail.mockRejectedValueOnce(
      new GoogleApiError('gmail.users.getProfile', status, reasons)
    )
    await expect(readGmailThreads({ accessToken: 'token', signal })).rejects.toMatchObject({
      failure,
    })
  })

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

describe('sharing a Gmail read across accounts', () => {
  it('reads the mailbox address once per credential, whatever token the credential holds', async () => {
    providerFetch.mockImplementation(async (url: string) =>
      url.includes('/threads?')
        ? respond({ threads: [{ id: 't' }] })
        : respond(gmailThread('t', [metadataMessage('Ada', 'S', 'P')]))
    )
    const read = (accessToken: string, credentialId: string) =>
      readGmailThreadsPage({ accessToken, signal, credentialId, accountId: 'account', count: 1 })
    await read('token-a', 'mailbox-cached')
    const rotated = await read('token-b', 'mailbox-cached')
    expect(mailboxEmail).toHaveBeenCalledTimes(1)
    expect(rotated.threads[0].url).toBe(gmailThreadUrl('t', 'reader@example.com'))
    await read('token-c', 'mailbox-other')
    expect(mailboxEmail).toHaveBeenCalledTimes(2)
  })

  it('reads the mailbox again when a reconnect moves the credential to another account', async () => {
    providerFetch.mockImplementation(async (url: string) =>
      url.includes('/threads?')
        ? respond({ threads: [{ id: 't' }] })
        : respond(gmailThread('t', [metadataMessage('Ada', 'S', 'P')]))
    )
    const read = (accountId: string) =>
      readGmailThreadsPage({
        accessToken: 'token',
        signal,
        credentialId: 'mailbox-reconnected',
        accountId,
        count: 1,
      })
    await read('account-old')
    mailboxEmail.mockResolvedValue('new@example.com')
    const reconnected = await read('account-new')
    expect(reconnected.threads[0].url).toBe(gmailThreadUrl('t', 'new@example.com'))
  })

  it('does not cache a failed mailbox lookup', async () => {
    providerFetch.mockImplementation(async (url: string) =>
      url.includes('/threads?')
        ? respond({ threads: [{ id: 't' }] })
        : respond(gmailThread('t', [metadataMessage('Ada', 'S', 'P')]))
    )
    mailboxEmail.mockRejectedValueOnce(new GoogleApiError('gmail.users.getProfile', 500, []))
    const read = () =>
      readGmailThreadsPage({
        accessToken: 't',
        signal,
        credentialId: 'mailbox-failed',
        accountId: 'account',
        count: 1,
      })
    await expect(read()).rejects.toMatchObject({ failure: 'unavailable' })
    await expect(read()).resolves.toMatchObject({ threads: [expect.anything()] })
  })

  it('a refused read repeats its threads rather than skipping them', async () => {
    const cursor: GmailThreadCursor = { mailbox: 'reader@example.com', unreadThreadIds: ['a', 'b'] }
    providerFetch.mockResolvedValueOnce(respond({ error: 'expired' }, 401))
    await expect(
      readMoreGmailThreads({ accessToken: 'old', signal, cursor, count: 1 })
    ).rejects.toMatchObject({ failure: 'token_rejected' })
    expect(cursor.unreadThreadIds).toEqual(['a', 'b'])
    providerFetch.mockResolvedValueOnce(respond(gmailThread('a', [metadataMessage('A', 'S', 'P')])))
    await readMoreGmailThreads({ accessToken: 'new', signal, cursor, count: 1 })
    expect(cursor.unreadThreadIds).toEqual(['b'])
  })

  const minute = (value: number) => new Date(Date.UTC(2026, 10, 5, 0, value)).toISOString()

  /** Runs the budgeted read the widget runs, against mailboxes listed newest first. */
  function mergeWithBudget(mailboxes: Record<string, number[]>, limit = HOME_EMAIL_THREAD_LIMIT) {
    const names = Object.keys(mailboxes)
    const budget = Math.ceil(limit / names.length)
    const cursors = new Map<string, GmailThreadCursor>(
      names.map((name) => [
        name,
        { mailbox: name, unreadThreadIds: mailboxes[name].slice(0, limit).map(String) },
      ])
    )
    const rows: { credentialId: string; receivedAt: string }[] = []
    let reads = 0
    const read = (name: string, count: number) => {
      const cursor = cursors.get(name) as GmailThreadCursor
      for (const id of cursor.unreadThreadIds.splice(0, count)) {
        reads += 1
        rows.push({ credentialId: name, receivedAt: minute(Number(id)) })
      }
    }
    for (const name of names) read(name, budget)
    for (;;) {
      const needed = gmailThreadsStillNeeded(rows, cursors, limit)
      if (needed.size === 0) break
      for (const [name, count] of needed) read(name, count)
    }
    const newest = (entries: typeof rows) =>
      [...entries]
        .sort((left, right) => compareStrings(right.receivedAt, left.receivedAt))
        .slice(0, limit)
        .map((row) => row.receivedAt)
    const everyThread = names.flatMap((name) =>
      mailboxes[name]
        .slice(0, limit)
        .map((value) => ({ credentialId: name, receivedAt: minute(value) }))
    )
    return { reads, shown: newest(rows), expected: newest(everyThread) }
  }

  const descending = (from: number, count: number, step = 1) =>
    Array.from({ length: count }, (_, index) => from - index * step)

  it.each([
    [
      'an even spread',
      {
        a: descending(900, 15, 4),
        b: descending(899, 15, 4),
        c: descending(898, 15, 4),
        d: descending(897, 15, 4),
      },
      19,
    ],
    [
      'one mailbox holding every recent thread',
      {
        a: descending(900, 15),
        b: descending(100, 15),
        c: descending(50, 15),
        d: descending(20, 15),
      },
      31,
    ],
    [
      'mailboxes too quiet to fill their share',
      { a: descending(900, 15), b: [800], c: [], d: [700, 600] },
      18,
    ],
    ['a single account', { a: descending(900, 15) }, 15],
    ['two accounts with disjoint weeks', { a: descending(900, 15), b: descending(500, 15) }, 23],
  ] as const)('shows what reading everything would, on %s', (_label, mailboxes, maxReads) => {
    const { shown, expected, reads } = mergeWithBudget(
      Object.fromEntries(Object.entries(mailboxes).map(([name, list]) => [name, [...list]]))
    )
    expect(shown).toEqual(expected)
    expect(reads).toBeLessThanOrEqual(maxReads)
  })
})
