/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import { EdgeManager } from '@/executor/execution/edge-manager'
import {
  compactPauseSnapshotScopes,
  serializePauseSnapshot,
} from '@/executor/execution/snapshot-serializer'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

function createContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    executionId: 'execution-1',
    userId: 'user-1',
    blockStates: new Map(),
    executedBlocks: new Set(),
    blockLogs: [],
    metadata: {
      requestId: 'request-1',
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      triggerType: 'manual',
      useDraftState: true,
      startTime: '2026-01-01T00:00:00.000Z',
    },
    environmentVariables: {},
    decisions: {
      router: new Map(),
      condition: new Map(),
    },
    completedLoops: new Set(),
    activeExecutionPath: new Set(),
    ...overrides,
  } as ExecutionContext
}

describe('serializePauseSnapshot', () => {
  it('persists encrypted resolved-secret provenance and the source execution id', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'raw-secret', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'raw-secret')
    const context = createContext({ resolvedSecretTraceRegistry: registry })

    const snapshot = serializePauseSnapshot(context, ['next-block'])
    const serialized = JSON.parse(snapshot.snapshot)

    expect(serialized.state.sourceExecutionId).toBe('execution-1')
    expect(serialized.state.resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: 'ciphertext' }],
    })
    expect(snapshot.snapshot).not.toContain('raw-secret')
  })

  it('persists a complete zero-entry provenance state for a fresh execution', () => {
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    const snapshot = serializePauseSnapshot(
      createContext({ resolvedSecretTraceRegistry: registry }),
      ['next-block']
    )
    const serialized = JSON.parse(snapshot.snapshot)

    expect(serialized.state.resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: true,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
  })

  it('serializes batched parallel accumulated outputs for cross-process resume', () => {
    const context = createContext({
      parallelExecutions: new Map([
        [
          'parallel-1',
          {
            parallelId: 'parallel-1',
            totalBranches: 3,
            branchOutputs: new Map([[2, [{ output: 'current-batch' }]]]),
            accumulatedOutputs: new Map([
              [0, [{ output: 'batch-0' }]],
              [1, [{ output: 'batch-1' }]],
            ]),
          },
        ],
      ]),
    })

    const snapshot = serializePauseSnapshot(context, ['next-block'])
    const serialized = JSON.parse(snapshot.snapshot)

    expect(serialized.state.parallelExecutions?.['parallel-1']).toMatchObject({
      branchOutputs: {
        2: [{ output: 'current-batch' }],
      },
      accumulatedOutputs: {
        0: [{ output: 'batch-0' }],
        1: [{ output: 'batch-1' }],
      },
    })
  })

  it('serializes deactivated edge state for resume', () => {
    const context = createContext()
    const sourceNode = {
      id: 'condition',
      block: {} as DAGNode['block'],
      incomingEdges: new Set<string>(),
      outgoingEdges: new Map([['if-edge', { target: 'target', sourceHandle: 'condition-if' }]]),
      metadata: {},
    }
    const targetNode = {
      id: 'target',
      block: {} as DAGNode['block'],
      incomingEdges: new Set(['condition']),
      outgoingEdges: new Map(),
      metadata: {},
    }
    const activeSourceNode = {
      id: 'active-source',
      block: {} as DAGNode['block'],
      incomingEdges: new Set<string>(),
      outgoingEdges: new Map([['active-edge', { target: 'active-target' }]]),
      metadata: {},
    }
    const activeTargetNode = {
      id: 'active-target',
      block: {} as DAGNode['block'],
      incomingEdges: new Set(['active-source']),
      outgoingEdges: new Map(),
      metadata: {},
    }
    const dag: DAG = {
      nodes: new Map([
        [sourceNode.id, sourceNode],
        [targetNode.id, targetNode],
        [activeSourceNode.id, activeSourceNode],
        [activeTargetNode.id, activeTargetNode],
      ]),
      loopConfigs: new Map(),
      parallelConfigs: new Map(),
    }
    const edgeManager = new EdgeManager(dag)
    edgeManager.processOutgoingEdges(sourceNode, { selectedOption: 'else' })
    edgeManager.processOutgoingEdges(activeSourceNode, { result: true })

    const snapshot = serializePauseSnapshot(context, ['next-block'], dag, edgeManager)
    const serialized = JSON.parse(snapshot.snapshot)

    expect(serialized.state.deactivatedEdges).toHaveLength(1)
    expect(serialized.state.nodesWithActivatedEdge).toEqual(['active-target'])
  })

  it('rejects oversized snapshot values without full JSON serialization', () => {
    const stringifySpy = vi.spyOn(JSON, 'stringify').mockImplementation(() => {
      throw new Error('full stringify should not be used for compactness checks')
    })
    const context = createContext({
      workflowVariables: {
        oversized: {
          type: 'string',
          value: 'x'.repeat(9 * 1024 * 1024),
        },
      },
    })

    try {
      expect(() => serializePauseSnapshot(context, ['next-block'])).toThrow(
        'Cannot serialize pause snapshot with oversized workflow variables'
      )
    } finally {
      stringifySpy.mockRestore()
    }
  })

  it('preserves an explicit useDraftState=true even when the context is a deployed (server-side) context', () => {
    const context = createContext({
      isDeployedContext: true,
      metadata: {
        requestId: 'request-1',
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        triggerType: 'manual',
        useDraftState: true,
        startTime: '2026-01-01T00:00:00.000Z',
      },
    })

    const snapshot = serializePauseSnapshot(context, ['next-block'])
    const serialized = JSON.parse(snapshot.snapshot)

    expect(serialized.metadata.useDraftState).toBe(true)
  })

  it('serializes billing attribution for an exact-payer resume', () => {
    const billingAttribution = {
      actorUserId: 'external-actor',
      workspaceId: 'workspace-1',
      organizationId: 'org-1',
      billedAccountUserId: 'owner-1',
      billingEntity: { type: 'organization' as const, id: 'org-1' },
      billingPeriod: {
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-08-01T00:00:00.000Z',
      },
      payerSubscription: null,
    }
    const context = createContext({
      metadata: {
        ...createContext().metadata,
        billingAttribution,
      },
    })

    const snapshot = serializePauseSnapshot(context, ['next-block'])
    const serialized = JSON.parse(snapshot.snapshot)

    expect(serialized.metadata.billingAttribution).toEqual(billingAttribution)
  })

  it('preserves independent chat event policies across pause and resume', () => {
    const context = createContext({
      metadata: {
        ...createContext().metadata,
        includeThinking: true,
        includeToolCalls: false,
        executionMode: 'stream',
      },
    })

    const snapshot = serializePauseSnapshot(context, ['next-block'])
    const serialized = JSON.parse(snapshot.snapshot)

    expect(serialized.metadata.includeThinking).toBe(true)
    expect(serialized.metadata.includeToolCalls).toBe(false)
    expect(serialized.metadata.executionMode).toBe('stream')
  })

  it('omits chat event policies when the live run did not enable them', () => {
    const snapshot = serializePauseSnapshot(createContext(), ['next-block'])
    const serialized = JSON.parse(snapshot.snapshot)

    expect(serialized.metadata.includeThinking).toBeUndefined()
    expect(serialized.metadata.includeToolCalls).toBeUndefined()
  })
})

describe('compactPauseSnapshotScopes', () => {
  const dag = { nodes: new Map<string, DAGNode>() } as unknown as DAG
  const edgeManager = new EdgeManager(dag)

  function fatIterations(count: number, bytes: number): any[][] {
    const payload = 'x'.repeat(bytes)
    // Real shape is an array per iteration, which routes oversized entries
    // through the chunked-manifest path rather than a single ref.
    return Array.from({ length: count }, () => [{ payload }])
  }

  function loopContext(overrides: Record<string, unknown>): ExecutionContext {
    return createContext({
      loopExecutions: new Map([
        [
          'loop-1',
          {
            iteration: 1,
            loopType: 'forEach',
            currentIterationOutputs: new Map(),
            allIterationOutputs: [],
            ...overrides,
          },
        ],
      ]),
    } as Partial<ExecutionContext>)
  }

  const serialize = (context: ExecutionContext) =>
    serializePauseSnapshot(context, [], dag, edgeManager)

  it('lets a pause inside a long-running loop serialize', async () => {
    const context = loopContext({ allIterationOutputs: fatIterations(40, 300_000) })

    expect(() => serialize(context)).toThrow('oversized loop execution state')
    await compactPauseSnapshotScopes(context)
    expect(serialize(context).snapshot).toBeTruthy()
  })

  /** A forEach collection is the most common way a loop's state gets large. */
  it('compacts the forEach collection, not just the iteration outputs', async () => {
    const context = loopContext({ items: fatIterations(40, 300_000) })

    expect(() => serialize(context)).toThrow('oversized loop execution state')
    await compactPauseSnapshotScopes(context)
    expect(serialize(context).snapshot).toBeTruthy()
  })

  /** A single fat mid-flight block output reaches the limit on its own. */
  it('compacts in-flight iteration outputs', async () => {
    const context = loopContext({
      currentIterationOutputs: new Map([['block-1', { payload: 'x'.repeat(9_000_000) }]]),
    })

    expect(() => serialize(context)).toThrow('oversized loop execution state')
    await compactPauseSnapshotScopes(context)
    expect(serialize(context).snapshot).toBeTruthy()
  })

  /** The assertion is on the whole record, so per-scope headroom is not enough. */
  it('compacts across multiple loops whose combined state is oversized', async () => {
    const context = createContext({
      loopExecutions: new Map([
        [
          'loop-1',
          {
            iteration: 1,
            currentIterationOutputs: new Map(),
            allIterationOutputs: fatIterations(15, 300_000),
          },
        ],
        [
          'loop-2',
          {
            iteration: 1,
            currentIterationOutputs: new Map(),
            allIterationOutputs: fatIterations(15, 300_000),
          },
        ],
      ]),
    } as Partial<ExecutionContext>)

    expect(() => serialize(context)).toThrow('oversized loop execution state')
    await compactPauseSnapshotScopes(context)
    expect(serialize(context).snapshot).toBeTruthy()
  })

  /** Parallels accumulate the same way and were previously not even asserted. */
  it('compacts accumulated parallel branch outputs', async () => {
    const context = createContext({
      parallelExecutions: new Map([
        [
          'parallel-1',
          {
            parallelId: 'parallel-1',
            totalBranches: 40,
            branchOutputs: new Map([[0, fatIterations(40, 300_000).flat()]]),
            accumulatedOutputs: new Map(),
          },
        ],
      ]),
    } as Partial<ExecutionContext>)

    expect(() => serialize(context)).toThrow('oversized parallel execution state')
    await compactPauseSnapshotScopes(context)
    expect(serialize(context).snapshot).toBeTruthy()
  })

  /** Refs are unusable unless the resumed run is authorized to read them. */
  it('authorizes the offloaded values for the resumed run', async () => {
    const context = loopContext({ allIterationOutputs: fatIterations(40, 300_000) })

    await compactPauseSnapshotScopes(context)
    const parsed = JSON.parse(serialize(context).snapshot) as {
      state?: { trustedLargeValueAccess?: { largeValueKeys?: string[] } }
    }

    expect(parsed.state?.trustedLargeValueAccess?.largeValueKeys?.length ?? 0).toBeGreaterThan(0)
  })

  /** Compaction is a structural rebuild, so a modest loop must not pay for it. */
  it('skips the rebuild entirely when the state already fits', async () => {
    const context = loopContext({ allIterationOutputs: fatIterations(2, 100) })
    const before = context.loopExecutions?.get('loop-1')?.allIterationOutputs

    await compactPauseSnapshotScopes(context)

    expect(context.loopExecutions?.get('loop-1')?.allIterationOutputs).toBe(before)
  })
})
