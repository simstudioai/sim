import { jsonResponse } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { typeformConnector } from '@/connectors/typeform/typeform'

const ACCESS_TOKEN = 'test-token'
const FORM_CONFIG = { formId: 'abc123' }

const mockFetch = vi.fn()

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
    vi.stubGlobal('fetch', mockFetch)
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
})

describe('typeform getDocument', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
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
