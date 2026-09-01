/**
 * @vitest-environment node
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockResolveSelectorOAuthAccessToken } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockResolveSelectorOAuthAccessToken: vi.fn(),
}))

vi.mock('@/lib/selectors/server/credentials', () => ({
  resolveSelectorOAuthAccessToken: mockResolveSelectorOAuthAccessToken,
}))

import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { bigQuerySelectorAttachments } from '@/lib/selectors/server/providers/bigquery'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const PROJECT_ID = 'selector-test'
const DATASET_ID = 'analytics'

interface DatasetFixture {
  datasetReference: { projectId: string; datasetId: string }
  friendlyName: string
}

interface TableFixture {
  tableReference: { projectId: string; datasetId: string; tableId: string }
  friendlyName: string
}

function args(
  selectorKey: 'bigquery.datasets' | 'bigquery.tables',
  request: ExecuteServerSelectorArgs['request']
): ExecuteServerSelectorArgs {
  return {
    selectorKey,
    context: {
      oauthCredential: 'credential-1',
      projectId: PROJECT_ID,
      ...(selectorKey === 'bigquery.tables' ? { datasetId: DATASET_ID } : {}),
    },
    request,
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-1' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

function dataset(datasetId: string, friendlyName: string, projectId = PROJECT_ID): DatasetFixture {
  return {
    datasetReference: { projectId, datasetId },
    friendlyName,
  }
}

function table(tableId: string, friendlyName: string): TableFixture {
  return {
    tableReference: { projectId: PROJECT_ID, datasetId: DATASET_ID, tableId },
    friendlyName,
  }
}

describe('BigQuery server selector adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveSelectorOAuthAccessToken.mockResolvedValue('server-only-token')
  })

  afterAll(() => vi.unstubAllGlobals())

  it('returns one dataset page and forwards its continuation token on demand', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            datasets: [dataset('dataset_1', 'Dataset 1')],
            nextPageToken: 'dataset-page-2',
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ datasets: [dataset('dataset_2', 'Dataset 2')] }), {
          status: 200,
        })
      )

    await expect(
      bigQuerySelectorAttachments['bigquery.datasets'].execute(
        args('bigquery.datasets', { kind: 'list' })
      )
    ).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'dataset_1', label: 'Dataset 1' }],
      nextCursor: 'dataset-page-2',
    })
    await expect(
      bigQuerySelectorAttachments['bigquery.datasets'].execute(
        args('bigquery.datasets', { kind: 'list', cursor: 'dataset-page-2' })
      )
    ).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'dataset_2', label: 'Dataset 2' }],
    })

    const firstUrl = new URL(String(mockFetch.mock.calls[0]?.[0]))
    const secondUrl = new URL(String(mockFetch.mock.calls[1]?.[0]))
    expect(firstUrl.searchParams.get('maxResults')).toBe('200')
    expect(firstUrl.searchParams.has('pageToken')).toBe(false)
    expect(secondUrl.searchParams.get('pageToken')).toBe('dataset-page-2')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('returns one table page and forwards its continuation token on demand', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tables: [table('table_1', 'Table 1')],
            nextPageToken: 'table-page-2',
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tables: [table('table_2', 'Table 2')] }), {
          status: 200,
        })
      )

    await expect(
      bigQuerySelectorAttachments['bigquery.tables'].execute(
        args('bigquery.tables', { kind: 'list' })
      )
    ).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'table_1', label: 'Table 1' }],
      nextCursor: 'table-page-2',
    })
    await expect(
      bigQuerySelectorAttachments['bigquery.tables'].execute(
        args('bigquery.tables', { kind: 'list', cursor: 'table-page-2' })
      )
    ).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'table_2', label: 'Table 2' }],
    })

    const firstUrl = new URL(String(mockFetch.mock.calls[0]?.[0]))
    const secondUrl = new URL(String(mockFetch.mock.calls[1]?.[0]))
    expect(firstUrl.searchParams.get('maxResults')).toBe('200')
    expect(firstUrl.searchParams.has('pageToken')).toBe(false)
    expect(secondUrl.searchParams.get('pageToken')).toBe('table-page-2')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('hydrates a selected dataset in a legacy domain-scoped project directly by id', async () => {
    const projectId = 'example.com:selector-test'
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(dataset('saved_dataset', 'Saved Dataset', projectId)), {
        status: 200,
      })
    )

    const detailArgs = args('bigquery.datasets', { kind: 'detail', id: 'saved_dataset' })
    detailArgs.context.projectId = projectId

    await expect(
      bigQuerySelectorAttachments['bigquery.datasets'].execute(detailArgs)
    ).resolves.toEqual({
      kind: 'detail',
      item: { id: 'saved_dataset', label: 'Saved Dataset' },
    })

    const url = new URL(String(mockFetch.mock.calls[0]?.[0]))
    expect(url.pathname).toBe(
      '/bigquery/v2/projects/example.com%3Aselector-test/datasets/saved_dataset'
    )
    expect(url.searchParams.get('datasetView')).toBe('METADATA')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('hydrates a selected table directly by its encoded id', async () => {
    const tableId = 'Sales Table-Δ'
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(table(tableId, 'Saved Table')), { status: 200 })
    )

    await expect(
      bigQuerySelectorAttachments['bigquery.tables'].execute(
        args('bigquery.tables', { kind: 'detail', id: tableId })
      )
    ).resolves.toEqual({
      kind: 'detail',
      item: { id: tableId, label: 'Saved Table' },
    })

    const url = new URL(String(mockFetch.mock.calls[0]?.[0]))
    expect(url.pathname).toBe(
      `/bigquery/v2/projects/${PROJECT_ID}/datasets/${DATASET_ID}/tables/Sales%20Table-%CE%94`
    )
    expect(url.searchParams.get('view')).toBe('BASIC')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['bigquery.datasets', { kind: 'detail', id: 'missing_dataset' }],
    ['bigquery.tables', { kind: 'detail', id: 'missing_table' }],
  ] as const)('returns null when %s detail is missing', async (selectorKey, request) => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }))

    await expect(
      bigQuerySelectorAttachments[selectorKey].execute(args(selectorKey, request))
    ).resolves.toEqual({ kind: 'detail', item: null })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
