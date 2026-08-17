/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSecureFetch } = vi.hoisted(() => ({ mockSecureFetch: vi.fn() }))

vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => ({
  secureFetchWithRetry: mockSecureFetch,
}))

import { buildBaseUrl, sameOriginNextUrl, zendeskConnector } from '@/connectors/zendesk/zendesk'

describe('buildBaseUrl', () => {
  it.concurrent('builds the base URL for a valid subdomain', () => {
    expect(buildBaseUrl('acme')).toBe('https://acme.zendesk.com')
  })

  it.concurrent('allows hyphens and digits within the label', () => {
    expect(buildBaseUrl('acme-support-1')).toBe('https://acme-support-1.zendesk.com')
  })

  it.concurrent('allows a single-character subdomain', () => {
    expect(buildBaseUrl('a')).toBe('https://a.zendesk.com')
  })

  it.concurrent('allows the maximum 63-character label', () => {
    const label = `a${'b'.repeat(61)}c`
    expect(label).toHaveLength(63)
    expect(buildBaseUrl(label)).toBe(`https://${label}.zendesk.com`)
  })

  it.concurrent('trims surrounding whitespace', () => {
    expect(buildBaseUrl('  acme  ')).toBe('https://acme.zendesk.com')
  })

  it.concurrent('normalizes uppercase to lowercase (DNS is case-insensitive)', () => {
    expect(buildBaseUrl('MyCompany')).toBe('https://mycompany.zendesk.com')
  })

  describe('rejects SSRF payloads', () => {
    const ssrfPayloads: Array<[string, string]> = [
      ['fragment truncation', 'webhook.site/abc#'],
      ['fragment with path', 'evil.com/path#'],
      ['embedded path', 'acme/api/v2'],
      ['scheme injection', 'http://evil.com'],
      ['userinfo', 'user@evil.com'],
      ['port', 'acme:8080'],
      ['open-redirect host', 'httpbin.org/redirect-to?url=http://169.254.169.254'],
      ['loopback', '127.0.0.1'],
      ['link-local literal', '169.254.169.254'],
      ['whitespace injection', 'acme evil'],
      ['leading hyphen', '-acme'],
      ['trailing hyphen', 'acme-'],
      ['leading dot', '.acme'],
      ['trailing dot', 'acme.'],
      ['empty string', ''],
      ['whitespace only', '   '],
      ['over-length label', 'a'.repeat(64)],
      ['unicode', 'acmé'],
    ]

    it.concurrent.each(ssrfPayloads)('rejects %s', (_label, payload) => {
      expect(() => buildBaseUrl(payload)).toThrow('Invalid Zendesk subdomain')
    })
  })
})

describe('sameOriginNextUrl', () => {
  const baseUrl = 'https://acme.zendesk.com'

  it.concurrent('accepts a continuation URL on the validated base URL', () => {
    const next = `${baseUrl}/api/v2/tickets.json?page%5Bafter%5D=abc`
    expect(sameOriginNextUrl(next, baseUrl)).toBe(next)
  })

  it.concurrent.each([
    ['a foreign host', 'https://evil.com/api/v2/tickets.json'],
    ['a host-prefix lookalike', 'https://acme.zendesk.com.evil.com/api/v2/tickets.json'],
    ['a bare base URL with no path separator', 'https://acme.zendesk.com'],
    ['a non-string value', 42],
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
  ])('rejects %s', (_label, next) => {
    expect(sameOriginNextUrl(next, baseUrl)).toBeNull()
  })
})

const BASE = 'https://acme.zendesk.com'
const CONFIG = { subdomain: 'acme', email: 'agent@acme.com', contentType: 'tickets' }

function ticket(id: number) {
  return {
    id,
    subject: `Ticket ${id}`,
    description: 'body',
    status: 'open',
    priority: 'normal',
    tags: ['a'],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-02-01T00:00:00Z',
  }
}

/** Answers each request URL with a JSON body, recording the URLs requested. */
function mockApi(handler: (url: string) => unknown): string[] {
  const urls: string[] = []
  mockSecureFetch.mockImplementation(async (url: string) => {
    urls.push(url)
    return { ok: true, status: 200, json: async () => handler(url) }
  })
  return urls
}

describe('zendeskConnector.listDocuments ticket capping', () => {
  beforeEach(() => {
    mockSecureFetch.mockReset()
  })

  it('caps the listing when the page carries more tickets than maxTickets', async () => {
    mockApi(() => ({ tickets: [ticket(1), ticket(2), ticket(3)], meta: { has_more: false } }))

    const syncContext: Record<string, unknown> = {}
    const result = await zendeskConnector.listDocuments(
      'tok',
      { ...CONFIG, maxTickets: '2' },
      undefined,
      syncContext
    )

    // Ticket 3 still exists at the source but was trimmed, so reconciling deletions
    // against this listing would hard-delete it.
    expect(result.documents.map((d) => d.externalId)).toEqual(['ticket-1', 'ticket-2'])
    expect(syncContext.listingCapped).toBe(true)
  })

  it('does not cap when the source is exhausted exactly at the limit', async () => {
    mockApi(() => ({ tickets: [ticket(1), ticket(2)], meta: { has_more: false } }))

    const syncContext: Record<string, unknown> = {}
    const result = await zendeskConnector.listDocuments(
      'tok',
      { ...CONFIG, maxTickets: '2' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(2)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('caps when the cursor still has a further page at the limit', async () => {
    mockApi(() => ({
      tickets: [ticket(1), ticket(2)],
      meta: { has_more: true },
      links: { next: `${BASE}/api/v2/tickets.json?page%5Bafter%5D=x` },
    }))

    const syncContext: Record<string, unknown> = {}
    await zendeskConnector.listDocuments(
      'tok',
      { ...CONFIG, maxTickets: '2' },
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBe(true)
  })

  it('drains the cursor and never sends offset page params', async () => {
    let page = 0
    const urls = mockApi(() => {
      page += 1
      return page === 1
        ? {
            tickets: [ticket(1)],
            meta: { has_more: true },
            links: { next: `${BASE}/api/v2/tickets.json?page%5Bafter%5D=x` },
          }
        : { tickets: [ticket(2)], meta: { has_more: false } }
    })

    const syncContext: Record<string, unknown> = {}
    const result = await zendeskConnector.listDocuments(
      'tok',
      { ...CONFIG, maxTickets: '500' },
      undefined,
      syncContext
    )

    expect(result.documents.map((d) => d.externalId)).toEqual(['ticket-1', 'ticket-2'])
    expect(urls[0]).toContain('page%5Bsize%5D=100')
    expect(urls[0]).toContain('sort=-updated_at')
    expect(syncContext.listingCapped).toBeUndefined()
  })
})

describe('zendeskConnector ticket contentHash invariant', () => {
  beforeEach(() => {
    mockSecureFetch.mockReset()
  })

  it('produces an identical contentHash from the listing stub and getDocument', async () => {
    mockApi(() => ({ tickets: [ticket(7)], meta: { has_more: false } }))
    const listed = await zendeskConnector.listDocuments('tok', CONFIG)
    const stub = listed.documents[0]

    mockApi((url) => (url.includes('/comments') ? { comments: [] } : { ticket: ticket(7) }))
    const hydrated = await zendeskConnector.getDocument('tok', CONFIG, 'ticket-7')

    expect(stub.contentDeferred).toBe(true)
    expect(hydrated?.contentDeferred).toBe(false)
    expect(hydrated?.contentHash).toBe(stub.contentHash)
    expect(hydrated?.externalId).toBe(stub.externalId)
    expect(hydrated?.sourceUrl).toBe(stub.sourceUrl)
  })

  it('returns null for a deleted ticket but rethrows a server fault', async () => {
    mockSecureFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    expect(await zendeskConnector.getDocument('tok', CONFIG, 'ticket-7')).toBeNull()

    mockSecureFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    await expect(zendeskConnector.getDocument('tok', CONFIG, 'ticket-7')).rejects.toThrow('500')
  })
})
