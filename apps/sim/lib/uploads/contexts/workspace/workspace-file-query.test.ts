/**
 * @vitest-environment node
 *
 * `queryWorkspaceFiles` — the paged, filtered, sorted read behind
 * `GET /api/v2/files`. The assertions are on the query it builds, because the
 * point of this function existing is that the scope filter, the name search,
 * the ordering, and the page slice all happen in SQL rather than over a
 * full-workspace result.
 */
import {
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/storage', () => ({
  decrementStorageUsageForBillingContextInTx: vi.fn(),
  incrementStorageUsageForBillingContextInTx: vi.fn(),
  maybeNotifyStorageLimitForBillingContext: vi.fn(),
  resolveStorageBillingContext: vi.fn(),
}))

vi.mock('@/lib/uploads', () => ({
  getServePathPrefix: vi.fn(() => '/api/files/serve/s3/'),
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  deleteFile: vi.fn(),
  downloadFile: vi.fn(),
  hasCloudStorage: vi.fn(() => false),
  headObject: vi.fn(),
  uploadFile: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  assertWorkspaceFileFolderTarget: vi.fn(async () => null),
  buildWorkspaceFileFolderPathMap: vi.fn(() => new Map()),
  fileNameExistsInWorkspaceFolder: vi.fn(async () => false),
  findWorkspaceFileFolderIdByPath: vi.fn(),
  getWorkspaceFileFolderPath: vi.fn(),
  listWorkspaceFileFolders: vi.fn(async () => []),
  normalizeWorkspaceFileItemName: vi.fn((name: string) => name),
  resolveWorkspaceFileFolderTarget: vi.fn(async () => null),
}))

import {
  listWorkspaceFiles,
  queryWorkspaceFiles,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const WS = 'workspace-1'

const DEFAULTS = { sortBy: 'uploadedAt', sortOrder: 'asc', limit: 100 } as const

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf_1',
    key: 'workspace/ws/1-x-data.csv',
    userId: 'user-1',
    workspaceId: WS,
    folderId: null,
    context: 'workspace',
    originalName: 'data.csv',
    contentType: 'text/csv',
    size: 1024,
    sizeBytes: 1024,
    deletedAt: null,
    uploadedAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    contentUpdatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  }
}

const lastConditions = () =>
  flattenMockConditions(dbChainMockFns.where.mock.calls.at(-1)?.[0]).filter(Boolean)

const lastOrderBy = () => dbChainMockFns.orderBy.mock.calls.at(-1) ?? []

describe('queryWorkspaceFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('narrows the query with a case-insensitive substring match on the file name', async () => {
    queueTableRows(schemaMock.workspaceFiles, [buildRow()])

    await queryWorkspaceFiles(WS, { ...DEFAULTS, search: 'data' })

    expect(lastConditions().find((c) => c.type === 'ilike')).toMatchObject({
      column: schemaMock.workspaceFiles.originalName,
      pattern: '%data%',
    })
  })

  it('escapes LIKE wildcards in the search term', async () => {
    queueTableRows(schemaMock.workspaceFiles, [])

    await queryWorkspaceFiles(WS, { ...DEFAULTS, search: '50%_off' })

    expect(lastConditions().find((c) => c.type === 'ilike')).toMatchObject({
      pattern: '%50\\%\\_off%',
    })
  })

  it('adds no search condition when the caller did not search', async () => {
    queueTableRows(schemaMock.workspaceFiles, [buildRow()])

    await queryWorkspaceFiles(WS, DEFAULTS)

    expect(lastConditions().some((c) => c.type === 'ilike')).toBe(false)
  })

  it('filters to one folder in the query', async () => {
    queueTableRows(schemaMock.workspaceFiles, [buildRow()])

    await queryWorkspaceFiles(WS, { ...DEFAULTS, folderId: 'fold_1' })

    expect(
      lastConditions().some(
        (c) =>
          c.type === 'eq' && c.left === schemaMock.workspaceFiles.folderId && c.right === 'fold_1'
      )
    ).toBe(true)
  })

  it('orders by the requested field, with id closing the keyset', async () => {
    queueTableRows(schemaMock.workspaceFiles, [buildRow()])

    await queryWorkspaceFiles(WS, { ...DEFAULTS, sortBy: 'name', sortOrder: 'desc' })

    expect(lastOrderBy()).toEqual([
      { type: 'desc', column: schemaMock.workspaceFiles.originalName },
      { type: 'desc', column: schemaMock.workspaceFiles.id },
    ])
  })

  it('bounds the page in SQL by fetching one row past the limit', async () => {
    queueTableRows(schemaMock.workspaceFiles, [buildRow()])

    await queryWorkspaceFiles(WS, { ...DEFAULTS, limit: 25 })

    expect(dbChainMockFns.limit).toHaveBeenLastCalledWith(26)
  })

  it('reports no further keys when the page is not full, terminating pagination', async () => {
    queueTableRows(schemaMock.workspaceFiles, [buildRow()])

    const { files, nextKeys } = await queryWorkspaceFiles(WS, { ...DEFAULTS, limit: 10 })

    expect(files).toHaveLength(1)
    expect(nextKeys).toBeNull()
  })

  it('returns the keyset of the last row when more results exist', async () => {
    queueTableRows(schemaMock.workspaceFiles, [
      buildRow(),
      buildRow({ id: 'wf_2', originalName: 'b.csv' }),
    ])

    const { files, nextKeys } = await queryWorkspaceFiles(WS, {
      ...DEFAULTS,
      sortBy: 'name',
      limit: 1,
    })

    expect(files.map((f) => f.id)).toEqual(['wf_1'])
    expect(nextKeys).toEqual(['data.csv', 'wf_1'])
  })

  it('resumes strictly after the cursor keys, alongside the filter', async () => {
    queueTableRows(schemaMock.workspaceFiles, [
      buildRow({ id: 'wf_2', originalName: 'data-2.csv' }),
    ])

    await queryWorkspaceFiles(WS, {
      ...DEFAULTS,
      sortBy: 'name',
      search: 'data',
      after: ['data.csv', 'wf_1'],
    })

    const conditions = lastConditions()
    expect(conditions.find((c) => c.type === 'ilike')).toMatchObject({ pattern: '%data%' })
    expect(conditions.some((c) => c.type === 'or')).toBe(true)
  })

  /**
   * Cursor contents are caller-controlled, so a value the key cannot hold is a
   * client error. Classified `validation` so the route renders 400, not 500.
   */
  it('rejects a cursor whose values do not fit the sort', async () => {
    queueTableRows(schemaMock.workspaceFiles, [buildRow()])

    await expect(
      queryWorkspaceFiles(WS, { ...DEFAULTS, sortBy: 'uploadedAt', after: ['not-a-date', 'wf_1'] })
    ).rejects.toMatchObject({ code: 'validation' })
  })

  it('rejects a cursor with the wrong number of keys for the sort', async () => {
    queueTableRows(schemaMock.workspaceFiles, [buildRow()])

    await expect(
      queryWorkspaceFiles(WS, { ...DEFAULTS, sortBy: 'name', after: ['data.csv'] })
    ).rejects.toMatchObject({ code: 'validation' })
  })
})

/**
 * `listWorkspaceFiles` materializes a whole scope, so what it reads per row is
 * multiplied by the size of the workspace. These assertions pin the two ways that
 * stays bounded: the projection, and the optional row cap its one budgeted caller
 * (the workspace layout's server seed) uses to detect an oversized workspace.
 */
describe('listWorkspaceFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  const lastProjection = () =>
    Object.keys((dbChainMockFns.select.mock.calls.at(-1)?.[0] ?? {}) as Record<string, unknown>)

  it('projects only the columns the record mapper reads', async () => {
    queueTableRows(schemaMock.workspaceFiles, [buildRow()])

    await listWorkspaceFiles(WS)

    const projected = lastProjection()
    expect(projected).toEqual(
      expect.arrayContaining(['id', 'key', 'originalName', 'sizeBytes', 'contentUpdatedAt'])
    )
    /** Columns no reader projects; `select()` would ship them for every row of the scan. */
    expect(projected).not.toContain('context')
    expect(projected).not.toContain('chatId')
    expect(projected).not.toContain('messageId')
    expect(projected).not.toContain('displayName')
    expect(projected).not.toContain('secretProvenanceVersion')
  })

  it('reads the whole scope when no cap is given', async () => {
    queueTableRows(schemaMock.workspaceFiles, [buildRow()])

    await listWorkspaceFiles(WS)

    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
  })

  it('caps the rows read when the caller only needs to fit a budget', async () => {
    queueTableRows(schemaMock.workspaceFiles, [buildRow()])

    await listWorkspaceFiles(WS, { limit: 2 })

    expect(dbChainMockFns.limit).toHaveBeenCalledWith(2)
  })
})
