/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listLogsMock,
  statsLogsMock,
  fetchLogDetailMock,
  toOverviewMock,
  toFullMock,
  toTraceMock,
  grepSpansMock,
} = vi.hoisted(() => ({
  listLogsMock: vi.fn(),
  statsLogsMock: vi.fn(),
  fetchLogDetailMock: vi.fn(),
  toOverviewMock: vi.fn(),
  toFullMock: vi.fn(),
  toTraceMock: vi.fn(),
  grepSpansMock: vi.fn(),
}))

vi.mock('@/lib/logs/list-logs', () => ({ listLogs: listLogsMock }))
vi.mock('@/lib/logs/stats-logs', () => ({ statsLogs: statsLogsMock }))
vi.mock('@/lib/logs/fetch-log-detail', () => ({ fetchLogDetail: fetchLogDetailMock }))
vi.mock('@/lib/logs/log-views', () => ({
  toOverview: toOverviewMock,
  toFull: toFullMock,
  toTrace: toTraceMock,
  grepSpans: grepSpansMock,
}))
vi.mock('@/lib/execution/payloads/large-execution-value', () => ({
  collectLargeValueExecutionIds: vi.fn(() => []),
  collectLargeValueKeys: vi.fn(() => []),
}))

import { queryLogsServerTool } from './query-logs'

const ctx = { userId: 'user-1', workspaceId: 'ws-1' }

function detail(overrides: Record<string, unknown> = {}) {
  return {
    executionId: 'exec-1',
    workflowId: 'wf-1',
    status: 'success',
    trigger: 'manual',
    cost: { total: 0.1 },
    executionData: { totalDuration: 1234, traceSpans: [{ id: 's1' }] },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('queryLogsServerTool', () => {
  it('list view delegates to listLogs and leads with total and cursor', async () => {
    listLogsMock.mockResolvedValue({ data: [{ id: 'log-1' }], nextCursor: null, total: 42 })

    const result = await queryLogsServerTool.execute(
      { view: 'list', sortBy: 'date', sortOrder: 'desc', limit: 100 } as any,
      ctx
    )

    expect(listLogsMock).toHaveBeenCalledTimes(1)
    const [params, userId] = listLogsMock.mock.calls[0]
    expect(userId).toBe('user-1')
    expect(params.workspaceId).toBe('ws-1')
    expect(params.includeTotal).toBe(true)
    expect(params).not.toHaveProperty('view')
    expect(params).not.toHaveProperty('title')
    expect(result).toEqual({ total: 42, nextCursor: null, data: [{ id: 'log-1' }] })
    expect(Object.keys(result as object)).toEqual(['total', 'nextCursor', 'data'])
  })

  it('stats view delegates to statsLogs with the workspace scoped in', async () => {
    statsLogsMock.mockResolvedValue({ totals: { executions: 7 } })

    const result = await queryLogsServerTool.execute(
      { view: 'stats', bucket: 'day', timezone: 'UTC', workflowIds: 'wf-1' } as any,
      ctx
    )

    expect(statsLogsMock).toHaveBeenCalledTimes(1)
    const [params, userId] = statsLogsMock.mock.calls[0]
    expect(userId).toBe('user-1')
    expect(params).toMatchObject({ workspaceId: 'ws-1', bucket: 'day', workflowIds: 'wf-1' })
    expect(result).toEqual({ totals: { executions: 7 } })
  })

  it('defaults to the condensed trace digest when only an executionId is given', async () => {
    fetchLogDetailMock.mockResolvedValue(detail())
    toTraceMock.mockReturnValue([{ blockId: 'blk-1', name: 'Agent', executions: 3 }])

    const result: any = await queryLogsServerTool.execute({ executionId: 'exec-1' } as any, ctx)

    expect(toTraceMock).toHaveBeenCalledTimes(1)
    expect(result.blocks).toEqual([{ blockId: 'blk-1', name: 'Agent', executions: 3 }])
    expect(toOverviewMock).not.toHaveBeenCalled()
    expect(toFullMock).not.toHaveBeenCalled()
  })

  it('defaults to list when no executionId is given', async () => {
    listLogsMock.mockResolvedValue({ data: [], nextCursor: null, total: 0 })

    await queryLogsServerTool.execute({} as any, ctx)

    expect(listLogsMock).toHaveBeenCalledTimes(1)
  })

  it('passes blockIds and fields through to toFull', async () => {
    fetchLogDetailMock.mockResolvedValue(detail())
    toFullMock.mockResolvedValue([{ id: 's1' }])

    await queryLogsServerTool.execute(
      {
        view: 'full',
        executionId: 'exec-1',
        blockIds: ['blk-1', 'blk-2'],
        fields: ['output.rows'],
      } as any,
      ctx
    )

    expect(toFullMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { blockId: undefined, blockIds: ['blk-1', 'blk-2'], blockName: undefined },
      ['output.rows']
    )
  })

  it('overview view returns the projected span tree', async () => {
    fetchLogDetailMock.mockResolvedValue(detail())
    toOverviewMock.mockReturnValue([{ id: 's1', name: 'A' }])

    const result: any = await queryLogsServerTool.execute(
      { view: 'overview', executionId: 'exec-1' } as any,
      ctx
    )

    expect(result.executionId).toBe('exec-1')
    expect(result.durationMs).toBe(1234)
    expect(result.spans).toEqual([{ id: 's1', name: 'A' }])
    expect(toFullMock).not.toHaveBeenCalled()
  })

  it('full view returns materialized spans', async () => {
    fetchLogDetailMock.mockResolvedValue(detail())
    toFullMock.mockResolvedValue([{ id: 's1', input: { a: 1 } }])

    const result: any = await queryLogsServerTool.execute(
      { view: 'full', executionId: 'exec-1', blockId: 'blk-1' } as any,
      ctx
    )

    expect(toFullMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        blockId: 'blk-1',
        blockIds: undefined,
        blockName: undefined,
      },
      undefined
    )
    expect(result.spans).toEqual([{ id: 's1', input: { a: 1 } }])
    expect(result.truncated).toBe(false)
  })

  it('full view falls back to overview when the result is too large', async () => {
    fetchLogDetailMock.mockResolvedValue(detail())
    const huge = 'x'.repeat(600 * 1024)
    toFullMock.mockResolvedValue([{ id: 's1', output: huge }])
    toOverviewMock.mockReturnValue([{ id: 's1', name: 'A' }])

    const result: any = await queryLogsServerTool.execute(
      { view: 'full', executionId: 'exec-1' } as any,
      ctx
    )

    expect(result.truncated).toBe(true)
    expect(result.note).toContain('too large')
    expect(result.spans).toEqual([{ id: 's1', name: 'A' }])
  })

  it('pattern runs grepSpans and returns matches', async () => {
    fetchLogDetailMock.mockResolvedValue(detail())
    grepSpansMock.mockResolvedValue({
      matches: [{ spanId: 's1', name: 'A', field: 'output', snippet: '…timeout…' }],
      truncated: false,
    })

    const result: any = await queryLogsServerTool.execute(
      { view: 'full', executionId: 'exec-1', pattern: 'timeout' } as any,
      ctx
    )

    expect(grepSpansMock).toHaveBeenCalledTimes(1)
    expect(result.pattern).toBe('timeout')
    expect(result.matches).toHaveLength(1)
    expect(toFullMock).not.toHaveBeenCalled()
  })

  it('returns not-found for an unknown executionId', async () => {
    fetchLogDetailMock.mockResolvedValue(null)
    const result: any = await queryLogsServerTool.execute(
      { view: 'overview', executionId: 'missing' } as any,
      ctx
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('missing')
  })

  it('throws when unauthenticated', async () => {
    await expect(
      queryLogsServerTool.execute({ view: 'overview', executionId: 'exec-1' } as any, {} as any)
    ).rejects.toThrow('Unauthorized')
  })

  it('rejects overview/full without executionId via inputSchema', () => {
    const schema = queryLogsServerTool.inputSchema!
    expect(schema.safeParse({ view: 'overview', workspaceId: 'ws-1' }).success).toBe(false)
    expect(schema.safeParse({ view: 'full', workspaceId: 'ws-1' }).success).toBe(false)
    expect(
      schema.safeParse({ view: 'overview', workspaceId: 'ws-1', executionId: 'e1' }).success
    ).toBe(true)
  })
})
