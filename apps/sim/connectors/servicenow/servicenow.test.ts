import { jsonResponse } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { servicenowConnector, shouldIngestKBArticle } from '@/connectors/servicenow/servicenow'

const INSTANCE_URL = 'https://acme.service-now.com'
const SYS_ID_A = 'a'.repeat(32)
const SYS_ID_B = 'b'.repeat(32)
const _SYS_ID_C = 'c'.repeat(32)

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
function _kbRecordPlain(sysId: string, workflowState?: string): Record<string, unknown> {
  return {
    sys_id: sysId,
    ...(workflowState === undefined ? {} : { workflow_state: workflowState }),
    short_description: `Article ${sysId.slice(0, 4)}`,
    text: `Body of ${sysId.slice(0, 4)}`,
  }
}

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

/** Reads the URL passed to the single fetch call as a parsed URL. */
function lastRequestUrl(): URL {
  const [url] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
  return new URL(url as string)
}

describe('shouldIngestKBArticle', () => {
  it.concurrent('excludes retired articles', () => {
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: 'retired' })).toBe(false)
  })

  it.concurrent('keeps outdated articles, which may be the latest version past valid_to', () => {
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: 'outdated' })).toBe(true)
  })

  it.concurrent('fails open when workflow_state is missing, empty or not a string', () => {
    expect(shouldIngestKBArticle({ sys_id: 'a' })).toBe(true)
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: '' })).toBe(true)
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: '   ' })).toBe(true)
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: null })).toBe(true)
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: 42 })).toBe(true)
    expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: {} })).toBe(true)
  })

  it.concurrent('applies no implicit filter once the user selects a state explicitly', () => {
    for (const selection of ['all', 'retired', 'outdated', 'published', 'draft', 'review']) {
      expect(shouldIngestKBArticle({ sys_id: 'a', workflow_state: 'retired' }, selection)).toBe(
        true
      )
    }
  })
})

describe('servicenowConnector.listDocuments', () => {
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
})

describe('servicenowConnector.getDocument', () => {
  it('rejects a malformed sys_id without issuing a request', async () => {
    const doc = await servicenowConnector.getDocument('key', { ...KB_CONFIG }, '../../secrets')

    expect(doc).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
