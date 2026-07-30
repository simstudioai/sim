/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/icons', () => ({
  ServiceNowIcon: () => null,
}))

import { servicenowConnector, shouldIngestKBArticle } from '@/connectors/servicenow/servicenow'

const INSTANCE_URL = 'https://acme.service-now.com'
const SYS_ID_A = 'a'.repeat(32)
const SYS_ID_B = 'b'.repeat(32)
const SYS_ID_C = 'c'.repeat(32)

const KB_CONFIG = {
  instanceUrl: INSTANCE_URL,
  username: 'svc',
  contentType: 'kb_knowledge',
} as const

/**
 * Wraps a value the way `sysparm_display_value=all` does. Under `all` the Table
 * API returns EVERY column — `sys_id` included — as `{ display_value, value }`,
 * so fixtures must use this shape to exercise the real listing path.
 */
function field(value: string): { display_value: string; value: string } {
  return { display_value: value, value }
}

/** Builds a `kb_knowledge` row in the `sysparm_display_value=all` wire shape. */
function kbRecord(sysId: string, workflowState?: string): Record<string, unknown> {
  return {
    sys_id: field(sysId),
    ...(workflowState === undefined ? {} : { workflow_state: field(workflowState) }),
    short_description: field(`Article ${sysId.slice(0, 4)}`),
    text: field(`Body of ${sysId.slice(0, 4)}`),
  }
}

/** Builds the same row in the plain-string shape (`display_value` absent/true/false). */
function kbRecordPlain(sysId: string, workflowState?: string): Record<string, unknown> {
  return {
    sys_id: sysId,
    ...(workflowState === undefined ? {} : { workflow_state: workflowState }),
    short_description: `Article ${sysId.slice(0, 4)}`,
    text: `Body of ${sysId.slice(0, 4)}`,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Reads the URL passed to the single fetch call as a parsed URL. */
function lastRequestUrl(): URL {
  const [url] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
  return new URL(url as string)
}

describe('shouldIngestKBArticle', () => {
  it.concurrent('keeps published, draft and review articles', () => {
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: 'published' })).toBe(true)
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: 'draft' })).toBe(true)
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: 'review' })).toBe(true)
  })

  it.concurrent('excludes retired articles', () => {
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: 'retired' })).toBe(false)
  })

  it.concurrent('keeps outdated articles, which may be the latest version past valid_to', () => {
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: 'outdated' })).toBe(true)
  })

  it.concurrent('keeps pending-retirement articles, which are still visible', () => {
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: 'pending retirement' })).toBe(true)
  })

  it.concurrent('reads the sysparm_display_value=all object shape', () => {
    expect(
      shouldIngestKBArticle({
        sys_id: 'a',
        workflow_state: { value: 'retired', display_value: 'Retired' },
      })
    ).toBe(false)
    expect(
      shouldIngestKBArticle({
        sys_id: 'a',
        workflow_state: { value: 'published', display_value: 'Published' },
      })
    ).toBe(true)
  })

  it.concurrent('falls back to display_value when no raw value is present', () => {
    expect(
      shouldIngestKBArticle({ sys_id: 'a', workflow_state: { display_value: 'Retired' } })
    ).toBe(false)
  })

  it.concurrent('is case and whitespace insensitive', () => {
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: '  Retired ' })).toBe(false)
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: 'RETIRED' })).toBe(false)
  })

  it.concurrent('fails open when workflow_state is missing, empty or not a string', () => {
    expect(shouldIngestKBArticle({ sys_id: 'a' })).toBe(true)
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: '' })).toBe(true)
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: '   ' })).toBe(true)
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: null })).toBe(true)
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: 42 })).toBe(true)
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: {} })).toBe(true)
  })

  it.concurrent('fails open on unrecognised custom workflow states', () => {
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: 'pending_translation' })).toBe(true)
  })

  it.concurrent('applies no implicit filter once the user selects a state explicitly', () => {
    for (const selection of ['all', 'retired', 'outdated', 'published', 'draft', 'review']) {
      expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: 'retired' }, selection)).toBe(
        true
      )
    }
  })

  it.concurrent('treats an absent or blank selection as unset and filters', () => {
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: 'retired' })).toBe(false)
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: 'retired' }, undefined)).toBe(false)
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: 'retired' }, '')).toBe(false)
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: 'retired' }, '  ')).toBe(false)
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: 'retired' }, null)).toBe(false)
  })
})

describe('servicenowConnector.listDocuments', () => {
  it('accepts the sysparm_display_value=all object shape, where sys_id is an object', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ result: [kbRecord(SYS_ID_A, 'published')] }))

    const list = await servicenowConnector.listDocuments('key', { ...KB_CONFIG })

    expect(lastRequestUrl().searchParams.get('sysparm_display_value')).toBe('all')
    expect(list.documents).toHaveLength(1)
    expect(list.documents[0].externalId).toBe(SYS_ID_A)
    expect(list.documents[0].title).toBe(`Article ${SYS_ID_A.slice(0, 4)}`)
    expect(list.documents[0].sourceUrl).toBe(`${INSTANCE_URL}/kb_view.do?sys_kb_id=${SYS_ID_A}`)
    expect(list.documents[0].metadata.workflowState).toBe('published')
  })

  it('still accepts the plain-string shape', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        result: [kbRecordPlain(SYS_ID_A, 'published'), kbRecordPlain(SYS_ID_B, 'retired')],
      })
    )

    const list = await servicenowConnector.listDocuments('key', { ...KB_CONFIG })

    expect(list.documents.map((doc) => doc.externalId)).toEqual([SYS_ID_A])
    expect(list.documents[0].title).toBe(`Article ${SYS_ID_A.slice(0, 4)}`)
  })

  it('skips records whose sys_id object carries no usable value', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        result: [
          { ...kbRecord(SYS_ID_A, 'published'), sys_id: { display_value: null, value: '' } },
          kbRecord(SYS_ID_B, 'published'),
        ],
      })
    )

    const list = await servicenowConnector.listDocuments('key', { ...KB_CONFIG })

    expect(list.documents.map((doc) => doc.externalId)).toEqual([SYS_ID_B])
  })

  it('drops retired KB records and keeps every other state', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        result: [
          kbRecord(SYS_ID_A, 'published'),
          kbRecord(SYS_ID_B, 'retired'),
          kbRecord(SYS_ID_C, 'outdated'),
        ],
      })
    )

    const list = await servicenowConnector.listDocuments('key', { ...KB_CONFIG })

    expect(list.documents.map((doc) => doc.externalId)).toEqual([SYS_ID_A, SYS_ID_C])
  })

  it('keeps records with a missing or unrecognised workflow_state (fail open)', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        result: [
          kbRecord(SYS_ID_A),
          kbRecord(SYS_ID_B, ''),
          kbRecord(SYS_ID_C, 'pending retirement'),
        ],
      })
    )

    const list = await servicenowConnector.listDocuments('key', { ...KB_CONFIG })

    expect(list.documents.map((doc) => doc.externalId)).toEqual([SYS_ID_A, SYS_ID_B, SYS_ID_C])
  })

  it('applies no implicit filter when the user selected a workflow state', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ result: [kbRecord(SYS_ID_A, 'retired'), kbRecord(SYS_ID_B, 'retired')] })
    )

    const list = await servicenowConnector.listDocuments('key', {
      ...KB_CONFIG,
      workflowState: 'retired',
    })

    expect(list.documents.map((doc) => doc.externalId)).toEqual([SYS_ID_A, SYS_ID_B])
    expect(lastRequestUrl().searchParams.get('sysparm_query')).toContain('workflow_state=retired')
  })

  it('applies no implicit filter under the explicit "All States" selection', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ result: [kbRecord(SYS_ID_A, 'published'), kbRecord(SYS_ID_B, 'retired')] })
    )

    const list = await servicenowConnector.listDocuments('key', {
      ...KB_CONFIG,
      workflowState: 'all',
    })

    expect(list.documents.map((doc) => doc.externalId)).toEqual([SYS_ID_A, SYS_ID_B])
    expect(lastRequestUrl().searchParams.get('sysparm_query')).not.toContain('workflow_state')
  })

  it('leaves incidents unfiltered even when workflowState is set', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        result: [
          {
            sys_id: field(SYS_ID_A),
            number: field('INC001'),
            short_description: field('Down'),
            state: { display_value: 'Closed', value: '7' },
          },
          {
            sys_id: field(SYS_ID_B),
            number: field('INC002'),
            short_description: field('Up'),
            workflow_state: field('retired'),
          },
        ],
      })
    )

    const list = await servicenowConnector.listDocuments('key', {
      instanceUrl: INSTANCE_URL,
      username: 'svc',
      contentType: 'incident',
      workflowState: 'published',
    })

    expect(list.documents.map((doc) => doc.externalId)).toEqual([SYS_ID_A, SYS_ID_B])
    expect(lastRequestUrl().pathname).toBe('/api/now/table/incident')
  })

  it('keeps paging when a full page is filtered away entirely', async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) =>
      kbRecord(index.toString(16).padStart(32, '0'), 'retired')
    )
    mockFetch.mockResolvedValueOnce(jsonResponse({ result: fullPage }))

    const list = await servicenowConnector.listDocuments('key', { ...KB_CONFIG, maxItems: '500' })

    expect(list.documents).toEqual([])
    expect(list.hasMore).toBe(true)
    expect(list.nextCursor).toBe('100')
  })

  it('derives the cursor from the API result count, not the filtered document count', async () => {
    const page = Array.from({ length: 100 }, (_, index) =>
      kbRecord(index.toString(16).padStart(32, '0'), index === 0 ? 'published' : 'retired')
    )
    mockFetch.mockResolvedValueOnce(jsonResponse({ result: page }))

    const list = await servicenowConnector.listDocuments('key', {
      ...KB_CONFIG,
      maxItems: '500',
    })

    expect(list.documents).toHaveLength(1)
    expect(list.nextCursor).toBe('100')

    mockFetch.mockResolvedValueOnce(jsonResponse({ result: [] }))
    await servicenowConnector.listDocuments('key', { ...KB_CONFIG, maxItems: '500' }, '100')
    expect(lastRequestUrl().searchParams.get('sysparm_offset')).toBe('100')
  })

  it('stops paging on a short page', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ result: [kbRecord(SYS_ID_A, 'published')] }))

    const list = await servicenowConnector.listDocuments('key', { ...KB_CONFIG })

    expect(list.hasMore).toBe(false)
    expect(list.nextCursor).toBeUndefined()
  })
})

describe('servicenowConnector.getDocument', () => {
  it('hydrates a retired article without re-filtering it', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ result: kbRecord(SYS_ID_A, 'retired') }))

    const doc = await servicenowConnector.getDocument('key', { ...KB_CONFIG }, SYS_ID_A)

    expect(doc?.externalId).toBe(SYS_ID_A)
    expect(doc?.metadata.workflowState).toBe('retired')
  })

  it('hydrates a published article', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ result: kbRecord(SYS_ID_A, 'published') }))

    const doc = await servicenowConnector.getDocument('key', { ...KB_CONFIG }, SYS_ID_A)

    expect(doc?.externalId).toBe(SYS_ID_A)
    expect(doc?.sourceUrl).toBe(`${INSTANCE_URL}/kb_view.do?sys_kb_id=${SYS_ID_A}`)
    expect(lastRequestUrl().pathname).toBe(`/api/now/table/kb_knowledge/${SYS_ID_A}`)
    expect(lastRequestUrl().searchParams.get('sysparm_display_value')).toBe('all')
  })

  it('hydrates an article returned in the plain-string shape', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ result: kbRecordPlain(SYS_ID_A, 'published') }))

    const doc = await servicenowConnector.getDocument('key', { ...KB_CONFIG }, SYS_ID_A)

    expect(doc?.externalId).toBe(SYS_ID_A)
  })

  it('rejects a malformed sys_id without issuing a request', async () => {
    const doc = await servicenowConnector.getDocument('key', { ...KB_CONFIG }, '../../secrets')

    expect(doc).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns null on a 404', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 404 }))

    const doc = await servicenowConnector.getDocument('key', { ...KB_CONFIG }, SYS_ID_A)

    expect(doc).toBeNull()
  })
})
