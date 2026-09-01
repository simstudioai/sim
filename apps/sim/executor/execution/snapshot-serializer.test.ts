/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import { EdgeManager } from '@/executor/execution/edge-manager'
import { serializePauseSnapshot } from '@/executor/execution/snapshot-serializer'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

function createContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  const principal = createTestRuntimePrincipal()
  return {
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    executionId: 'execution-1',
    userId: 'user-1',
    principal,
    blockStates: new Map(),
    executedBlocks: new Set(),
    blockLogs: [],
    metadata: {
      requestId: 'request-1',
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      principal,
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
    expect(serialized.state.resolvedSecretTraceCheckpointVersion).toBe(1)
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

  it('persists only encrypted value-adjacent provenance across pause and resume', () => {
    const provenance = {
      version: 1 as const,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: 'ciphertext' }],
    }
    const context = createContext({
      blockStates: new Map([
        [
          'function-1',
          {
            output: { result: '{{TOKEN}}' },
            executed: true,
            executionTime: 1,
            resolvedSecretTraceProvenance: provenance,
          },
        ],
      ]),
      blockLogs: [
        {
          blockId: 'function-1',
          startedAt: '2026-01-01T00:00:00.000Z',
          endedAt: '2026-01-01T00:00:00.001Z',
          durationMs: 1,
          success: true,
          output: { result: '{{TOKEN}}' },
          executionOrder: 1,
          displayResolvedSecretTraceProvenance: provenance,
        },
      ],
      workflowVariables: {
        secretResult: { type: 'string', value: '{{TOKEN}}' },
      },
      workflowVariableResolvedSecretTraceProvenance: {
        secretResult: provenance,
      },
      workflowInputResolvedSecretTraceProvenance: provenance,
      finalOutputResolvedSecretTraceProvenance: provenance,
    })

    const snapshot = serializePauseSnapshot(context, ['next-block'])
    const serialized = JSON.parse(snapshot.snapshot)

    expect(serialized.state.blockStates['function-1'].resolvedSecretTraceProvenance).toEqual(
      provenance
    )
    expect(serialized.state.blockLogs[0].displayResolvedSecretTraceProvenance).toEqual(provenance)
    expect(serialized.state.workflowVariableResolvedSecretTraceProvenance.secretResult).toEqual(
      provenance
    )
    expect(serialized.state.workflowInputResolvedSecretTraceProvenance).toEqual(provenance)
    expect(serialized.state.finalOutputResolvedSecretTraceProvenance).toEqual(provenance)
    expect(snapshot.snapshot).not.toContain('raw-secret')
  })

  it('does not persist a temporary activation guard as permanent incompleteness', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'raw-secret', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'raw-secret')
    const completePendingActivation = registry.beginPendingActivation()

    const snapshot = serializePauseSnapshot(
      createContext({ resolvedSecretTraceRegistry: registry }),
      ['next-block']
    )
    const serialized = JSON.parse(snapshot.snapshot)

    expect(serialized.state.resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: 'ciphertext' }],
    })
    expect(snapshot.snapshot).not.toContain('raw-secret')
    completePendingActivation()
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
