/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { typeformConnector } from '@/connectors/typeform/typeform'

const ACCESS_TOKEN = 'test-token'
const FORM_CONFIG = { formId: 'abc123' }

const mockFetch = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const FORM_DEFINITION = {
  id: 'abc123',
  title: 'Feedback',
  fields: [{ id: 'f1', title: 'How was it?' }],
  _links: { display: 'https://form.typeform.com/to/abc123' },
}

/** Queues the form-definition fetch that always precedes the responses fetch. */
function mockFormThenResponses(responsesBody: unknown) {
  mockFetch
    .mockResolvedValueOnce(jsonResponse(FORM_DEFINITION))
    .mockResolvedValueOnce(jsonResponse(responsesBody))
}

/** Resolves the URL of the nth (0-indexed) fetch the connector performed. */
function requestUrl(callIndex = 0): URL {
  const call = mockFetch.mock.calls[callIndex]
  if (!call) throw new Error(`No fetch call at index ${callIndex}`)
  return new URL(String(call[0]))
}

describe('typeform listDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the response_type filter explicitly rather than relying on the API default', async () => {
    mockFormThenResponses({ items: [] })

    await typeformConnector.listDocuments(ACCESS_TOKEN, FORM_CONFIG)

    expect(requestUrl(1).searchParams.get('response_type')).toBe('completed')
  })

  /**
   * Typeform documents only `partial` and `completed` as `response_type` members,
   * so `all` must not send an undocumented `started`: an unknown enum member risks
   * a 400 that fails the entire sync.
   */
  it('requests only the documented response types for the "all" choice', async () => {
    mockFormThenResponses({ items: [] })

    await typeformConnector.listDocuments(ACCESS_TOKEN, { ...FORM_CONFIG, responseType: 'all' })

    expect(requestUrl(1).searchParams.get('response_type')).toBe('partial,completed')
  })

  it('derives an incremental since filter at the second precision the API documents', async () => {
    mockFormThenResponses({ items: [] })

    await typeformConnector.listDocuments(
      ACCESS_TOKEN,
      FORM_CONFIG,
      undefined,
      {},
      new Date('2026-03-20T14:00:59.123Z')
    )

    expect(requestUrl(1).searchParams.get('since')).toBe('2026-03-20T14:00:59Z')
  })

  /**
   * A `multi_format` answer is an object carrying the recording plus Typeform's
   * generated transcript — not a string. Rendering it directly would index the
   * literal text "[object Object]".
   */
  it('renders the transcript of a multi_format answer', async () => {
    mockFormThenResponses({
      items: [
        {
          response_id: 'r1',
          token: 't1',
          submitted_at: '2026-03-20T14:00:59Z',
          answers: [
            {
              field: { id: 'f1' },
              type: 'multi_format',
              multi_format: {
                video_url: 'https://api.typeform.com/video/xyz',
                video_transcript: 'It was great',
              },
            },
          ],
        },
      ],
    })

    const result = await typeformConnector.listDocuments(ACCESS_TOKEN, FORM_CONFIG)

    expect(result.documents[0].content).toContain('How was it?: It was great')
  })

  /**
   * Each variable stores its value under the property named by its own `type`
   * (`text` or `number`); there is no generic `value` property to read.
   */
  it('renders variable values from their type-named property', async () => {
    mockFormThenResponses({
      items: [
        {
          response_id: 'r1',
          token: 't1',
          submitted_at: '2026-03-20T14:00:59Z',
          answers: [],
          variables: [
            { key: 'score', type: 'number', number: 42 },
            { key: 'source', type: 'text', text: 'newsletter' },
          ],
        },
      ],
    })

    const result = await typeformConnector.listDocuments(ACCESS_TOKEN, FORM_CONFIG)

    expect(result.documents[0].content).toContain('score: 42')
    expect(result.documents[0].content).toContain('source: newsletter')
  })

  it('flags the listing capped only when maxResponses hides responses that still exist', async () => {
    mockFormThenResponses({
      items: [
        { response_id: 'r1', token: 't1', submitted_at: '2026-03-20T14:00:59Z' },
        { response_id: 'r2', token: 't2', submitted_at: '2026-03-20T13:00:59Z' },
      ],
    })

    const capped: Record<string, unknown> = {}
    const result = await typeformConnector.listDocuments(
      ACCESS_TOKEN,
      { ...FORM_CONFIG, maxResponses: '1' },
      undefined,
      capped
    )

    expect(result.documents).toHaveLength(1)
    expect(result.hasMore).toBe(false)
    expect(capped.listingCapped).toBe(true)
  })

  it('leaves listingCapped unset when the cap lands exactly on source exhaustion', async () => {
    mockFormThenResponses({
      items: [{ response_id: 'r1', token: 't1', submitted_at: '2026-03-20T14:00:59Z' }],
    })

    const syncContext: Record<string, unknown> = {}
    await typeformConnector.listDocuments(
      ACCESS_TOKEN,
      { ...FORM_CONFIG, maxResponses: '1' },
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('produces the same contentHash from listDocuments and getDocument', async () => {
    const item = { response_id: 'r1', token: 't1', submitted_at: '2026-03-20T14:00:59Z' }
    mockFormThenResponses({ items: [item] })
    const syncContext: Record<string, unknown> = {}
    const listed = await typeformConnector.listDocuments(
      ACCESS_TOKEN,
      FORM_CONFIG,
      undefined,
      syncContext
    )

    mockFetch.mockResolvedValueOnce(jsonResponse({ items: [item] }))
    const fetched = await typeformConnector.getDocument(
      ACCESS_TOKEN,
      FORM_CONFIG,
      'r1',
      syncContext
    )

    expect(fetched?.contentHash).toBe(listed.documents[0].contentHash)
  })
})

describe('typeform getDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null when the response is absent from the result set', async () => {
    mockFormThenResponses({ items: [] })

    await expect(
      typeformConnector.getDocument(ACCESS_TOKEN, FORM_CONFIG, 'missing')
    ).resolves.toBeNull()
  })

  /**
   * Swallowing a server error into `null` would let the sync engine treat a live
   * response as deleted, so anything other than a 404 must surface.
   */
  it('throws on a server error instead of reporting the response as deleted', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(FORM_DEFINITION))
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))

    await expect(typeformConnector.getDocument(ACCESS_TOKEN, FORM_CONFIG, 'r1')).rejects.toThrow(
      '500'
    )
  })
})
