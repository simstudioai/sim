/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TraceSpan } from '@/lib/logs/types'

const { mockSelect, mockSelectPolicies, mockCheckWorkspaceAccess, mockMaterialize } = vi.hoisted(
  () => ({
    mockSelect: vi.fn(),
    mockSelectPolicies: vi.fn(),
    mockCheckWorkspaceAccess: vi.fn(),
    mockMaterialize: vi.fn(),
  })
)

// Two queries per depth now — the child log rows, then the publisher policy for the
// blocks they belong to. Routed by table so neither test has to know the call order.
vi.mock('@sim/db', () => ({
  db: {
    select: (columns: Record<string, unknown>) => ({
      from: () => ({
        where: (...args: unknown[]) =>
          'traceChildRuns' in columns ? mockSelectPolicies(...args) : mockSelect(...args),
      }),
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
    // Publishers of every source workflow the tests reference have opted in; the
    // closed-policy cases override this.
    mockSelectPolicies.mockImplementation(() =>
      Promise.resolve(
        ['wf-source', 'wf-b', 'wf-c'].map((workflowId) => ({ workflowId, traceChildRuns: true }))
      )
    )
    mockCheckWorkspaceAccess.mockResolvedValue({ hasAccess: true })
    mockMaterialize.mockResolvedValue({ traceSpans: [childSpan()] })
  })

  it('splices the child run in under the boundary span', async () => {
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
    // The child's graph snapshot rides along, so canvas drill-down works too.
    expect(spans[0].childWorkflowSnapshotId).toBe('snap-1')
  })

  it('joins an opted-in run without consulting the reader at all', async () => {
    // The publisher's policy is the whole answer and is the same for everyone. Adding
    // a reader check — against a consumer who by design has no access to the source
    // workspace — would refuse every read the feature exists to serve.
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

    const result = await hydrateChildTraces(spans, { viewerUserId: 'outsider-with-no-access' })

    expect(result.hydrated).toBe(1)
    expect(spans[0].childTraceAccess).toBe('granted')
    expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
  })

  it('joins the same run for an actorless read, which carries no reader at all', async () => {
    // A scheduled run inspecting its own child has no user on its principal. The
    // viewer is attribution, never a gate, so its absence must change nothing about
    // what is joined — and must not throw, which is how this broke in production.
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

    const result = await hydrateChildTraces(spans, {})

    expect(result.hydrated).toBe(1)
    expect(spans[0].childTraceAccess).toBe('granted')
    expect(spans[0].children?.[0].name).toBe('Agent 1')
    expect(spans[0].childWorkflowSnapshotId).toBe('snap-1')
    // Pinned rather than left implicit: materialization is told there is no owner,
    // instead of being handed a stand-in the run never authorized.
    expect(mockMaterialize).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ workspaceId: 'ws-source', userId: undefined })
    )
  })

  it('refuses a handle whose block is not opted in, however it got there', async () => {
    // The decisive case: handles persisted before this policy existed meant "a child
    // ran, authorize the reader", not "the publisher consented". Reading presence as
    // consent would hand out the internals of every block that never opted in.
    mockSelect.mockResolvedValue([
      {
        executionId: 'child-exec-1',
        workspaceId: 'ws-source',
        workflowId: 'wf-source',
        stateSnapshotId: 'snap-1',
        executionData: {},
      },
    ])
    mockSelectPolicies.mockResolvedValue([{ workflowId: 'wf-source', traceChildRuns: false }])
    const spans = [boundarySpan('child-exec-1')]

    const result = await hydrateChildTraces(spans, { viewerUserId: 'user-1' })

    expect(result.hydrated).toBe(0)
    expect(result.dropped.policyClosed).toBe(1)
    expect(spans[0].childTraceAccess).toBe('disabled')
    expect(spans[0].children).toEqual([])
    // Nothing about the source may be materialized for a closed block.
    expect(mockMaterialize).not.toHaveBeenCalled()
    expect(spans[0].childWorkflowSnapshotId).toBeUndefined()
  })

  it('fails closed when the block behind a handle no longer exists', async () => {
    // Unpublished, or deleted: there is no publisher left to have consented.
    mockSelect.mockResolvedValue([
      {
        executionId: 'child-exec-1',
        workspaceId: 'ws-source',
        workflowId: 'wf-source',
        stateSnapshotId: null,
        executionData: {},
      },
    ])
    mockSelectPolicies.mockResolvedValue([])
    const spans = [boundarySpan('child-exec-1')]

    const result = await hydrateChildTraces(spans, { viewerUserId: 'user-1' })

    expect(result.dropped.policyClosed).toBe(1)
    expect(spans[0].childTraceAccess).toBe('disabled')
  })

  it('fails closed when the policy read itself throws', async () => {
    mockSelect.mockResolvedValue([
      {
        executionId: 'child-exec-1',
        workspaceId: 'ws-source',
        workflowId: 'wf-source',
        stateSnapshotId: null,
        executionData: {},
      },
    ])
    mockSelectPolicies.mockRejectedValue(new Error('policy read failed'))
    const spans = [boundarySpan('child-exec-1')]

    const result = await hydrateChildTraces(spans, { viewerUserId: 'user-1' })

    expect(result.dropped.policyClosed).toBe(1)
    expect(spans[0].childTraceAccess).toBe('disabled')
  })

  it('reads each block policy once no matter how many boundaries resolve to it', async () => {
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

    expect(mockSelectPolicies).toHaveBeenCalledTimes(1)
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

  it('follows a NESTED custom block into its own source workspace', async () => {
    // Orchestrator -> impl (ws-b) -> sub-impl (ws-c). Each hop's handle was written by
    // its own publisher's opt-in, so the walk simply follows what is there.
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
    // The child's own span carries the next boundary handle, exactly as `createBaseSpan`
    // stamps it when the middle workflow's log row is written.
    mockMaterialize.mockResolvedValue({
      traceSpans: [childSpan({ childExecutionId: 'grandchild-exec-1' })],
    })
    const spans = [boundarySpan('child-exec-1')]

    const result = await hydrateChildTraces(spans, { viewerUserId: 'user-1' })

    expect(result.hydrated).toBe(2)
    expect(spans[0].childTraceAccess).toBe('granted')
    expect(spans[0].children?.[0].childTraceAccess).toBe('granted')
    expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
  })

  it('does nothing when no span carries a boundary handle', async () => {
    const spans = [{ ...boundarySpan('x'), childExecutionId: undefined }]

    const result = await hydrateChildTraces(spans, { viewerUserId: 'user-1' })

    expect(result.hydrated).toBe(0)
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('joins a custom block invoked as an Agent tool, nested under the agent span', async () => {
    // The handle sits on a tool child span rather than a top-level block span. Nothing
    // here special-cases that — the boundary walk already recurses — so this pins the
    // property the Agent-tool path depends on.
    mockSelect.mockResolvedValue([
      {
        executionId: 'child-exec-1',
        workspaceId: 'ws-source',
        workflowId: 'wf-source',
        stateSnapshotId: 'snap-1',
        executionData: {},
      },
    ])
    const toolSpan: TraceSpan = {
      id: 'agent-1-tool-0',
      name: 'Invoice Parser',
      type: 'tool',
      duration: 8,
      startTime: '2026-01-01T00:00:00.001Z',
      endTime: '2026-01-01T00:00:00.009Z',
      childExecutionId: 'child-exec-1',
    }
    const agentSpan: TraceSpan = {
      id: 'agent-1',
      name: 'Agent 1',
      type: 'agent',
      duration: 10,
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-01T00:00:00.010Z',
      blockId: 'agent-blk-1',
      children: [toolSpan],
    }

    const result = await hydrateChildTraces([agentSpan], { viewerUserId: 'user-1' })

    expect(result.hydrated).toBe(1)
    expect(toolSpan.childTraceAccess).toBe('granted')
    expect(toolSpan.children?.[0].name).toBe('Agent 1')
  })

  it('never joins an untraced boundary, since it carries no handle at all', async () => {
    // The opt-out is enforced at write time: with no `childExecutionId` there is nothing
    // for a reader to look up, whatever access they hold.
    const spans: TraceSpan[] = [
      { ...boundarySpan('unused'), childExecutionId: undefined, childTraceDisabled: true },
    ]

    const result = await hydrateChildTraces(spans, { viewerUserId: 'user-1' })

    expect(result.hydrated).toBe(0)
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
    // Untouched by hydration: the marker stays the only thing the UI reads.
    expect(spans[0].childTraceAccess).toBeUndefined()
    expect(spans[0].childTraceDisabled).toBe(true)
  })
})
