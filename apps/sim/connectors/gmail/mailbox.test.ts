import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getGmailMailboxEmail, gmailThreadUrl } from '@/connectors/gmail/mailbox'

const { transport } = vi.hoisted(() => ({ transport: vi.fn<typeof fetch>() }))
vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => ({
  fetchWithRetry: (
    url: string,
    init: RequestInit,
    options: {
      fetcher: (url: string, init: RequestInit, transport: typeof fetch) => Promise<Response>
    }
  ) => options.fetcher(url, init, transport),
}))

beforeEach(() => {
  transport.mockReset()
  transport.mockResolvedValue(
    Response.json({ emailAddress: 'Alice+work@example.com', historyId: '123' })
  )
})

describe('Gmail mailbox identity', () => {
  it('selects the authenticated mailbox before an archived-thread fragment', async () => {
    const email = await getGmailMailboxEmail('mailbox-token', {})
    const url = new URL(gmailThreadUrl('19a3f0123456789', email))
    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.pathname).toBe('/AccountChooser')
    expect(url.searchParams.get('Email')).toBe('alice+work@example.com')
    expect(url.hash).toBe('')
    const destination = new URL(url.searchParams.get('continue')!)
    expect(destination.origin).toBe('https://mail.google.com')
    expect(destination.pathname).toBe('/mail/')
    expect(destination.searchParams.get('authuser')).toBe('alice+work@example.com')
    expect(destination.hash).toBe('#all/19a3f0123456789')
    expect(transport).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile?fields=emailAddress,historyId',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer mailbox-token' }),
      })
    )
  })

  it('isolates credentials even if the same context is mistakenly reused', async () => {
    const context = {}
    await getGmailMailboxEmail('alice-token', context)
    transport.mockImplementation(async () =>
      Response.json({ emailAddress: 'bob@example.com', historyId: '321' })
    )
    expect(await getGmailMailboxEmail('bob-token', context)).toBe('bob@example.com')
    await getGmailMailboxEmail('bob-token', {})
    expect(transport).toHaveBeenCalledTimes(3)
  })

  it.each([
    {},
    { emailAddress: '', historyId: '1' },
    { emailAddress: 'not-an-email', historyId: '1' },
    { emailAddress: 'alice@example.com', historyId: 123 },
    { emailAddress: 'alice@example.com', historyId: 'invalid' },
  ])('rejects malformed profiles instead of falling back to account zero: %j', async (body) => {
    transport.mockResolvedValue(Response.json(body))
    await expect(getGmailMailboxEmail('token', {})).rejects.toThrow('malformed profile')
  })

  it('does not cache a failed lookup', async () => {
    transport.mockResolvedValueOnce(Response.json({}))
    const context = {}
    await expect(getGmailMailboxEmail('token', context)).rejects.toThrow()
    expect(await getGmailMailboxEmail('token', context)).toBe('alice+work@example.com')
  })

  it('bounds profile responses', async () => {
    transport.mockResolvedValue(Response.json({ padding: 'x'.repeat(17 * 1024) }))
    await expect(getGmailMailboxEmail('token', {})).rejects.toThrow()
  })

  it('encodes fragment delimiters rather than allowing them to change the link target', () => {
    const chooser = new URL(gmailThreadUrl('thread/?#id', 'alice@example.com'))
    expect(new URL(chooser.searchParams.get('continue')!).hash).toBe('#all/thread%2F%3F%23id')
  })
})
