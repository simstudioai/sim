/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TraceSpan } from '@/lib/logs/types'

const { mockSelect, mockCheckWorkspaceAccess, mockMaterialize } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
  mockMaterialize: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: (...args: unknown[]) => mockSelect(...args) }),
    }),
  },
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

vi.mock('@/lib/logs/execution/trace-store', () => ({
  materializeExecutionDataForDisplay: mockMaterialize,
  stripSpanCosts: (spans: unknown) => {
    if (!Array.isArray(spans)) return
    for (const span of spans) {
      if (span && typeof span === 'object') {
        const record = span as { cost?: unknown; children?: unknown }
        if ('cost' in record) record.cost = undefined
        if (Array.isArray(record.children)) {
          for (const child of record.children) {
            if (child && typeof child === 'object' && 'cost' in child) {
              ;(child as { cost?: unknown }).cost = undefined
            }
          }
        }
      }
    }
  },
}))

import { hydrateChildTraces } from '@/lib/logs/execution/hydrate-child-traces'

const boundarySpan = (childExecutionId: string): TraceSpan => ({
  id: 'span-1',
  name: 'Invoice Parser',
  type: 'custom_block_abc',
  duration: 10,
  startTime: '2026-01-01T00:00:00.000Z',
  endTime: '2026-01-01T00:00:00.010Z',
  children: [],
  blockId: 'blk-1',
  childExecutionId,
})

const childSpan = (overrides: Partial<TraceSpan> = {}): TraceSpan => ({
  id: 'child-span-1',
  name: 'Agent 1',
  type: 'agent',
  duration: 5,
  startTime: '2026-01-01T00:00:00.001Z',
  endTime: '2026-01-01T00:00:00.006Z',
  blockId: 'child-blk-1',
  ...overrides,
})

describe('hydrateChildTraces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockResolvedValue([])
    mockCheckWorkspaceAccess.mockResolvedValue({ hasAccess: true })
    mockMaterialize.mockResolvedValue({ traceSpans: [childSpan()] })
  })

  it('splices the child run in when the viewer can read the source workspace', async () => {
    mockSelect.mockResolvedValue([
      {
        executionId: 'child-exec-1',
        workspaceId: 'ws-source',
        workflowId: 'wf-source',
        stateSnapshotId: 'snap-1',
        executionData: {},
      },
    ])
    const spans = [boundarySpan('child-exec-1')]

    const result = await hydrateChildTraces(spans, { viewerUserId: 'user-1' })

    expect(result.hydrated).toBe(1)
    expect(spans[0].childTraceAccess).toBe('granted')
    expect(spans[0].children).toHaveLength(1)
    expect(spans[0].children?.[0].name).toBe('Agent 1')
    // Drill-down into the child's canvas only becomes available once authorized.
    expect(spans[0].childWorkflowSnapshotId).toBe('snap-1')
  })

  it('leaves the boundary shut when the viewer has no access to the source workspace', async () => {
    mockSelect.mockResolvedValue([
      {
        executionId: 'child-exec-1',
        workspaceId: 'ws-source',
        workflowId: 'wf-source',
        stateSnapshotId: 'snap-1',
        executionData: {},
      },
    ])
    mockCheckWorkspaceAccess.mockResolvedValue({ hasAccess: false })
    const spans = [boundarySpan('child-exec-1')]

    const result = await hydrateChildTraces(spans, { viewerUserId: 'outsider' })

    expect(result.hydrated).toBe(0)
    expect(result.dropped.denied).toBe(1)
    expect(spans[0].childTraceAccess).toBe('denied')
    expect(spans[0].children).toEqual([])
    // Nothing about the source may leak on a denied read.
    expect(spans[0].childWorkflowSnapshotId).toBeUndefined()
    expect(mockMaterialize).not.toHaveBeenCalled()
  })

  it('fails closed when the access check throws', async () => {
    mockSelect.mockResolvedValue([
      {
        executionId: 'child-exec-1',
        workspaceId: 'ws-source',
        workflowId: 'wf-source',
        stateSnapshotId: null,
        executionData: {},
      },
    ])
    mockCheckWorkspaceAccess.mockRejectedValue(new Error('permissions backend down'))
    const spans = [boundarySpan('child-exec-1')]

    const result = await hydrateChildTraces(spans, { viewerUserId: 'user-1' })

    expect(result.dropped.denied).toBe(1)
    expect(spans[0].childTraceAccess).toBe('denied')
  })

  it('marks a missing child log row rather than failing the parent read', async () => {
    mockSelect.mockResolvedValue([])
    const spans = [boundarySpan('child-exec-gone')]

    const result = await hydrateChildTraces(spans, { viewerUserId: 'user-1' })

    expect(result.dropped.missing).toBe(1)
    expect(spans[0].childTraceAccess).toBe('missing')
  })

  it('strips per-span cost, which is billed to the source workspace', async () => {
    mockSelect.mockResolvedValue([
      {
        executionId: 'child-exec-1',
        workspaceId: 'ws-source',
        workflowId: 'wf-source',
        stateSnapshotId: null,
        executionData: {},
      },
    ])
    mockMaterialize.mockResolvedValue({
      traceSpans: [childSpan({ cost: { total: 0.42 } })],
    })
    const spans = [boundarySpan('child-exec-1')]

    await hydrateChildTraces(spans, { viewerUserId: 'user-1' })

    expect(spans[0].children?.[0].cost).toBeUndefined()
  })

  it('checks each source workspace once no matter how many boundaries resolve to it', async () => {
    mockSelect.mockResolvedValue([
      {
        executionId: 'child-exec-1',
        workspaceId: 'ws-source',
        workflowId: 'wf-source',
        stateSnapshotId: null,
        executionData: {},
      },
      {
        executionId: 'child-exec-2',
        workspaceId: 'ws-source',
        workflowId: 'wf-source',
        stateSnapshotId: null,
        executionData: {},
      },
    ])
    const spans = [
      boundarySpan('child-exec-1'),
      { ...boundarySpan('child-exec-2'), id: 'span-2', blockId: 'blk-2' },
    ]

    await hydrateChildTraces(spans, { viewerUserId: 'user-1' })

    expect(mockCheckWorkspaceAccess).toHaveBeenCalledTimes(1)
  })

  it('reports boundaries dropped by the row cap instead of silently truncating', async () => {
    mockSelect.mockResolvedValue([])
    const spans = [
      boundarySpan('child-exec-1'),
      { ...boundarySpan('child-exec-2'), id: 'span-2' },
      { ...boundarySpan('child-exec-3'), id: 'span-3' },
    ]

    const result = await hydrateChildTraces(spans, { viewerUserId: 'user-1', maxRows: 1 })

    expect(result.dropped.rowLimited).toBe(2)
  })

  it('stops at maxDepth and reports the boundaries it did not follow', async () => {
    // Every child carries another boundary, so the walk would recurse forever without the cap.
    mockSelect.mockImplementation(() =>
      Promise.resolve([
        {
          executionId: 'child-exec-1',
          workspaceId: 'ws-source',
          workflowId: 'wf-source',
          stateSnapshotId: null,
          executionData: {},
        },
      ])
    )
    let nested = 0
    mockMaterialize.mockImplementation(() => {
      nested++
      return Promise.resolve({
        traceSpans: [childSpan({ id: `nested-${nested}`, childExecutionId: `deeper-${nested}` })],
      })
    })

    const spans = [boundarySpan('child-exec-1')]
    const result = await hydrateChildTraces(spans, {
      viewerUserId: 'user-1',
      maxDepth: 1,
      maxRows: 50,
    })

    expect(result.hydrated).toBe(1)
    expect(result.dropped.depthLimited).toBe(1)
    // The unfollowed boundary must SAY it was truncated: a boundary span with no children
    // and no marker renders exactly like a leaf, so a partial trace would read as complete.
    expect(spans[0].children?.[0].childTraceAccess).toBe('truncated')
  })

  it('marks row-capped boundaries as truncated rather than leaving them bare', async () => {
    mockSelect.mockResolvedValue([])
    const spans = [boundarySpan('child-exec-1'), { ...boundarySpan('child-exec-2'), id: 'span-2' }]

    await hydrateChildTraces(spans, { viewerUserId: 'user-1', maxRows: 1 })

    expect(spans[1].childTraceAccess).toBe('truncated')
  })

  it('authorizes each hop of a NESTED custom block against its own workspace', async () => {
    // Orchestrator -> impl (ws-b) -> sub-impl (ws-c). Access to the middle workspace must
    // never imply access to the innermost one, so each hop is checked separately.
    mockSelect
      .mockResolvedValueOnce([
        {
          executionId: 'child-exec-1',
          workspaceId: 'ws-b',
          workflowId: 'wf-b',
          stateSnapshotId: 'snap-b',
          executionData: {},
        },
      ])
      .mockResolvedValueOnce([
        {
          executionId: 'grandchild-exec-1',
          workspaceId: 'ws-c',
          workflowId: 'wf-c',
          stateSnapshotId: 'snap-c',
          executionData: {},
        },
      ])
    mockCheckWorkspaceAccess.mockImplementation((workspaceId: string) =>
      Promise.resolve({ hasAccess: workspaceId === 'ws-b' })
    )
    // The child's own span carries the next boundary handle, exactly as `createBaseSpan`
    // stamps it when the middle workflow's log row is written.
    mockMaterialize.mockResolvedValue({
      traceSpans: [childSpan({ childExecutionId: 'grandchild-exec-1' })],
    })
    const spans = [boundarySpan('child-exec-1')]

    const result = await hydrateChildTraces(spans, { viewerUserId: 'user-1' })

    expect(result.hydrated).toBe(1)
    expect(spans[0].childTraceAccess).toBe('granted')
    // The nested boundary was reached and independently refused.
    expect(spans[0].children?.[0].childTraceAccess).toBe('denied')
    expect(result.dropped.denied).toBe(1)
    expect(mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-b', 'user-1')
    expect(mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-c', 'user-1')
  })

  it('does nothing when no span carries a boundary handle', async () => {
    const spans = [{ ...boundarySpan('x'), childExecutionId: undefined }]

    const result = await hydrateChildTraces(spans, { viewerUserId: 'user-1' })

    expect(result.hydrated).toBe(0)
    expect(mockSelect).not.toHaveBeenCalled()
  })
})
