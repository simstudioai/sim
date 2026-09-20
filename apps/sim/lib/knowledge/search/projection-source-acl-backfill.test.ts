/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBackfill, mockEnd, mockPostgres, mockTasksTrigger } = vi.hoisted(() => ({
  mockBackfill: vi.fn(),
  mockEnd: vi.fn(async () => undefined),
  mockPostgres: vi.fn(),
  mockTasksTrigger: vi.fn(async () => ({ id: 'run-1' })),
}))

vi.mock('@sim/db', () => ({ resolveDbUrl: () => 'postgres://localhost:5432/sim' }))
vi.mock('@sim/db/script-migrations/0021_embedding_search_connector', () => ({
  PROJECTION_SOURCE_ACL_TABLES: ['embedding_search', 'embedding_keyword_tin'],
  PROJECTION_SOURCE_ACL_BACKFILL_OUTBOX_EVENT: 'knowledge.projection.source_acl.backfill',
  backfillProjectionSourceAcl: mockBackfill,
}))
vi.mock('postgres', () => ({ default: mockPostgres }))
vi.mock('@trigger.dev/sdk', () => ({ tasks: { trigger: mockTasksTrigger } }))
vi.mock('@/lib/core/async-jobs/region', () => ({ resolveTriggerRegion: async () => 'us-east-1' }))
vi.mock('@/lib/core/utils/background', () => ({
  runDetached: (_label: string, work: () => Promise<unknown>) => {
    void work()
  },
}))

import {
  enqueueProjectionSourceAclBackfill,
  projectionSourceAclBackfillOutboxHandlers,
  runProjectionSourceAclBackfill,
} from '@/lib/knowledge/search/projection-source-acl-backfill'

const connection = { end: mockEnd }

describe('runProjectionSourceAclBackfill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPostgres.mockReturnValue(connection)
    mockBackfill.mockImplementation(async (_sql, projection, options) => ({
      projection,
      scanned: 0,
      written: 0,
      afterId: options?.afterId ?? '',
      done: true,
    }))
  })

  it('fills both projections in order on its own connection and closes it', async () => {
    await expect(runProjectionSourceAclBackfill({ pageSize: 50, pauseMs: 10 })).resolves.toBeNull()
    expect(mockBackfill.mock.calls.map(([, projection]) => projection)).toEqual([
      'embedding_search',
      'embedding_keyword_tin',
    ])
    for (const [sql, , options] of mockBackfill.mock.calls) {
      expect(sql).toBe(connection)
      expect(options).toMatchObject({ afterId: undefined, pageSize: 50, pauseMs: 10 })
    }
    expect(mockEnd).toHaveBeenCalledTimes(1)
  })

  it('resumes after the cursor in its projection and from the start of the next', async () => {
    await runProjectionSourceAclBackfill({
      cursor: { projection: 'embedding_keyword_tin', afterId: 'chunk-9' },
    })
    expect(mockBackfill).toHaveBeenCalledTimes(1)
    expect(mockBackfill.mock.calls[0][1]).toBe('embedding_keyword_tin')
    expect(mockBackfill.mock.calls[0][2]).toMatchObject({ afterId: 'chunk-9' })
  })

  it('returns where a budgeted run stopped so the next run can carry on', async () => {
    mockBackfill.mockResolvedValueOnce({
      projection: 'embedding_search',
      scanned: 100,
      written: 100,
      afterId: 'chunk-100',
      done: false,
    })
    await expect(runProjectionSourceAclBackfill({}, { budgetMs: 1000 })).resolves.toEqual({
      projection: 'embedding_search',
      afterId: 'chunk-100',
    })
    expect(mockBackfill).toHaveBeenCalledTimes(1)
    expect(mockBackfill.mock.calls[0][2].budgetMs).toBeLessThanOrEqual(1000)
    expect(mockEnd).toHaveBeenCalledTimes(1)
  })

  it('closes the connection when a page fails', async () => {
    mockBackfill.mockRejectedValueOnce(new Error('canceling statement due to statement timeout'))
    await expect(runProjectionSourceAclBackfill({})).rejects.toThrow('statement timeout')
    expect(mockEnd).toHaveBeenCalledTimes(1)
  })
})

describe('enqueueProjectionSourceAclBackfill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPostgres.mockReturnValue(connection)
    mockBackfill.mockResolvedValue({
      projection: 'embedding_search',
      scanned: 0,
      written: 0,
      afterId: '',
      done: true,
    })
  })

  it('hands the backfill to the Trigger.dev worker when there is one', async () => {
    await expect(enqueueProjectionSourceAclBackfill({ pageSize: 25 }, true)).resolves.toEqual({
      runId: 'run-1',
    })
    expect(mockTasksTrigger).toHaveBeenCalledWith(
      'projection-source-acl-backfill',
      { pageSize: 25 },
      { region: 'us-east-1' }
    )
    expect(mockBackfill).not.toHaveBeenCalled()
  })

  it('fills the projections detached in this process without one', async () => {
    await expect(enqueueProjectionSourceAclBackfill({}, false)).resolves.toBeNull()
    expect(mockTasksTrigger).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(mockBackfill).toHaveBeenCalledTimes(2))
  })

  it('starts from the outbox event the migration leaves behind', () => {
    expect(Object.keys(projectionSourceAclBackfillOutboxHandlers)).toEqual([
      'knowledge.projection.source_acl.backfill',
    ])
  })
})
