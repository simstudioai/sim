/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockBackfill,
  mockEnd,
  mockPostgres,
  mockPrewarm,
  mockRunsList,
  mockTasksTrigger,
  mockUnsafe,
} = vi.hoisted(() => ({
  mockBackfill: vi.fn(),
  mockEnd: vi.fn(async () => undefined),
  mockPostgres: vi.fn(),
  mockPrewarm: vi.fn(async () => []),
  mockRunsList: vi.fn(
    (_query: unknown): AsyncIterable<{ id: string; status: string }> => (async function* () {})()
  ),
  mockTasksTrigger: vi.fn(async () => ({ id: 'run-1' })),
  mockUnsafe: vi.fn(async () => [{ unfilled: false }]),
}))

vi.mock('@sim/db', () => ({ resolveDbUrl: () => 'postgres://localhost:5432/sim' }))
vi.mock('@sim/db/script-migrations/0021_embedding_search_connector', () => ({
  PROJECTION_SOURCE_ACL_TABLES: ['embedding_search', 'embedding_keyword_tin'],
  backfillProjectionSourceAcl: mockBackfill,
}))
vi.mock('postgres', () => ({ default: mockPostgres }))
vi.mock('@/lib/knowledge/search/prewarm', () => ({ prewarmSearchProjection: mockPrewarm }))
vi.mock('@trigger.dev/sdk', () => ({
  runs: { list: mockRunsList },
  tasks: { trigger: mockTasksTrigger },
}))
vi.mock('@/lib/core/async-jobs/region', () => ({ resolveTriggerRegion: async () => 'us-east-1' }))
vi.mock('@/lib/core/utils/background', () => ({
  runDetached: (_label: string, work: () => Promise<unknown>) => {
    void work()
  },
}))

import {
  enqueueProjectionSourceAclBackfill,
  PROJECTION_PREWARM_BUDGET_MS,
  projectionSourceAclShardRange,
  runProjectionSourceAclBackfill,
} from '@/lib/knowledge/search/projection-source-acl-backfill'

const connection = { end: mockEnd, unsafe: mockUnsafe }

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

  it('analyzes and warms the projections on the same connection once both are filled, before closing it', async () => {
    await runProjectionSourceAclBackfill({})
    /**
     * A row whose document is gone is not the fill's to finish; the probe joins the document. It is
     * ordered and capped so only the unfilled-rows index can serve it: an `EXISTS` drops both and
     * leaves the planner a sequential scan of the projection.
     */
    const probes = mockUnsafe.mock.calls
      .map(([query]) => String(query).replace(/\s+/g, ' '))
      .filter((query) => query.includes('AS unfilled'))
    expect(probes).toHaveLength(2)
    for (const probe of probes) {
      expect(probe).not.toContain('EXISTS')
      expect(probe).toContain(
        'JOIN document d ON d.id = s.document_id WHERE s.acl IS NULL ORDER BY s.id DESC LIMIT 1 ) IS NOT NULL AS unfilled'
      )
    }
    expect(mockUnsafe.mock.calls.map(([query]) => query)).toEqual(
      expect.arrayContaining(['ANALYZE embedding_search', 'ANALYZE embedding_keyword_tin'])
    )
    expect(mockPrewarm).toHaveBeenCalledTimes(1)
    expect(mockPrewarm).toHaveBeenCalledWith(connection, { budgetMs: PROJECTION_PREWARM_BUDGET_MS })
    expect(mockPrewarm.mock.invocationCallOrder[0]).toBeLessThan(
      mockEnd.mock.invocationCallOrder[0]
    )
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
    expect(mockPrewarm).not.toHaveBeenCalled()
    expect(mockEnd).toHaveBeenCalledTimes(1)
  })

  it('closes the connection when a page fails', async () => {
    mockBackfill.mockRejectedValueOnce(new Error('canceling statement due to statement timeout'))
    await expect(runProjectionSourceAclBackfill({})).rejects.toThrow('statement timeout')
    expect(mockEnd).toHaveBeenCalledTimes(1)
  })

  it('fills only its shard of the id space in both projections', async () => {
    await runProjectionSourceAclBackfill({ shard: { index: 1, count: 4 } })
    for (const [, , options] of mockBackfill.mock.calls) {
      expect(options).toMatchObject({ afterId: '4', beforeId: '8' })
    }
  })

  it('resumes a shard after its cursor and keeps its upper bound', async () => {
    await runProjectionSourceAclBackfill({
      shard: { index: 1, count: 4 },
      cursor: { projection: 'embedding_search', afterId: '5a' },
    })
    expect(mockBackfill.mock.calls[0][2]).toMatchObject({ afterId: '5a', beforeId: '8' })
    expect(mockBackfill.mock.calls[1][2]).toMatchObject({ afterId: '4', beforeId: '8' })
  })

  it('leaves the analysis and the warm to whoever fills the rows another shard still holds', async () => {
    mockUnsafe.mockResolvedValueOnce([{ unfilled: true }])
    await expect(
      runProjectionSourceAclBackfill({ shard: { index: 0, count: 4 } })
    ).resolves.toBeNull()
    expect(mockUnsafe.mock.calls.map(([query]) => query)).not.toContain('ANALYZE embedding_search')
    expect(mockPrewarm).not.toHaveBeenCalled()
    expect(mockEnd).toHaveBeenCalledTimes(1)
  })
})

describe('projectionSourceAclShardRange', () => {
  it('slices the hex id space into contiguous ranges', () => {
    expect(projectionSourceAclShardRange({ index: 0, count: 4 })).toEqual({
      afterId: '',
      beforeId: '4',
    })
    expect(projectionSourceAclShardRange({ index: 3, count: 4 })).toEqual({
      afterId: 'c',
      beforeId: undefined,
    })
    expect(projectionSourceAclShardRange({ index: 0, count: 1 })).toEqual({
      afterId: '',
      beforeId: undefined,
    })
  })

  it.each([
    [{ index: 0, count: 3 }, 'shard count must divide 16'],
    [{ index: 0, count: 8 }, 'shard count must be at most 4'],
    [{ index: 4, count: 4 }, 'shard index must be within 0..3'],
    [{ index: 0.5, count: 2 }, 'shard index must be within 0..1'],
  ])('refuses %j', (shard, message) => {
    expect(() => projectionSourceAclShardRange(shard)).toThrow(message)
  })
})

describe('enqueueProjectionSourceAclBackfill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    /** No chain in flight unless a case says so. */
    mockRunsList.mockImplementation(() => (async function* () {})())
    mockPostgres.mockReturnValue(connection)
    mockBackfill.mockResolvedValue({
      projection: 'embedding_search',
      scanned: 0,
      written: 0,
      afterId: '',
      done: true,
    })
  })

  it('hands the backfill to the Trigger.dev worker when one is configured', async () => {
    await expect(enqueueProjectionSourceAclBackfill({ pageSize: 25 })).resolves.toEqual({
      runIds: ['run-1'],
      inFlight: [],
    })
    expect(mockRunsList).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'projection-source-acl-backfill:shard:0/1' })
    )
    expect(mockTasksTrigger).toHaveBeenCalledWith(
      'projection-source-acl-backfill',
      { pageSize: 25 },
      {
        region: 'us-east-1',
        tags: ['projection-source-acl-backfill:shard:0/1'],
        idempotencyKey: 'projection-source-acl-backfill:shard:0/1:after:none',
        idempotencyKeyTTL: '2m',
      }
    )
    expect(mockBackfill).not.toHaveBeenCalled()
  })

  it('keys a start after a chain that ended on that chain, so a restart is its own start', async () => {
    mockRunsList.mockImplementation(() =>
      (async function* () {
        yield { id: 'run-done', status: 'COMPLETED' }
      })()
    )
    await expect(enqueueProjectionSourceAclBackfill({})).resolves.toEqual({
      runIds: ['run-1'],
      inFlight: [],
    })
    expect(mockTasksTrigger.mock.calls[0][2].idempotencyKey).toBe(
      'projection-source-acl-backfill:shard:0/1:after:run-done'
    )
  })

  it('refuses a shard the id space cannot be sliced into before starting anything', async () => {
    await expect(
      enqueueProjectionSourceAclBackfill({ shard: { index: 5, count: 4 } })
    ).rejects.toThrow('shard index must be within 0..3')
    expect(mockTasksTrigger).not.toHaveBeenCalled()
  })

  it('leaves a range whose chain is still in flight to that chain', async () => {
    mockRunsList.mockImplementation((query: unknown) =>
      (async function* () {
        if ((query as { tag: string }).tag.endsWith(':shard:1/4'))
          yield { id: 'run-live', status: 'EXECUTING' }
      })()
    )
    await expect(enqueueProjectionSourceAclBackfill({}, 4)).resolves.toEqual({
      runIds: ['run-1', 'run-1', 'run-1'],
      inFlight: ['run-live'],
    })
    expect(mockTasksTrigger.mock.calls.map(([, payload]) => payload.shard?.index)).toEqual([
      0, 2, 3,
    ])
  })

  it('starts one run per shard, each on its own slice under its own chain tag', async () => {
    await expect(enqueueProjectionSourceAclBackfill({ pageSize: 25 }, 4)).resolves.toEqual({
      runIds: ['run-1', 'run-1', 'run-1', 'run-1'],
      inFlight: [],
    })
    expect(mockTasksTrigger.mock.calls.map(([, payload]) => payload)).toEqual(
      [0, 1, 2, 3].map((index) => ({ pageSize: 25, shard: { index, count: 4 } }))
    )
    expect(mockTasksTrigger.mock.calls.map(([, , options]) => options.tags)).toEqual(
      [0, 1, 2, 3].map((index) => [`projection-source-acl-backfill:shard:${index}/4`])
    )
  })

  it.each([
    [3, 'must divide 16'],
    [8, 'must be at most 4'],
  ])('refuses %s shards before starting anything', async (shards, message) => {
    await expect(enqueueProjectionSourceAclBackfill({}, shards)).rejects.toThrow(message)
    expect(mockTasksTrigger).not.toHaveBeenCalled()
  })

  it('refuses to slice a start that carries a cursor, which belongs to one chain', async () => {
    await expect(
      enqueueProjectionSourceAclBackfill(
        { cursor: { projection: 'embedding_search', afterId: '5a' } },
        4
      )
    ).rejects.toThrow('cannot start from a cursor')
    expect(mockTasksTrigger).not.toHaveBeenCalled()
  })
})
