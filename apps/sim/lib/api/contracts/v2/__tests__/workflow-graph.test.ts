/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  v2ApplyWorkflowOperationsDataSchema,
  v2ReplaceWorkflowStateBodySchema,
  v2WorkflowGraphSchema,
} from '@/lib/api/contracts/v2/workflows'
import { WORKFLOW_SKIPPED_ITEM_TYPES } from '@/lib/workflows/editing/types'

const STORED_GRAPH = {
  blocks: {
    'block-1': {
      id: 'block-1',
      type: 'starter',
      name: 'Start',
      position: { x: 0, y: 0 },
      subBlocks: { 'sub-1': { id: 'sub-1', type: 'oauth-input', value: 'credential-1' } },
      outputs: { result: { type: 'string' } },
      enabled: true,
      horizontalHandles: true,
      height: 0,
      data: { parentId: 'loop-1', extent: 'parent' },
      /** A stored key this surface does not publish. */
      layout: { measured: true },
    },
  },
  edges: [
    {
      id: 'edge-1',
      source: 'block-1',
      target: 'block-2',
      sourceHandle: null,
      targetHandle: null,
      /** Reactflow rendering members the stored row carries. */
      animated: true,
      style: { stroke: '#000' },
    },
  ],
  loops: {
    'loop-1': { id: 'loop-1', nodes: ['block-1'], iterations: 3, loopType: 'for', enabled: true },
  },
  parallels: {},
  variables: {
    'var-1': {
      id: 'var-1',
      name: 'region',
      type: 'string',
      value: 'eu',
      /** Server-stamped for the client's global variables store; not part of this surface. */
      workflowId: 'workflow-1',
    },
  },
}

describe('v2WorkflowGraphSchema', () => {
  /**
   * A v2 response schema is `.parse`d on the way out, so a stored member the
   * surface has not published must be stripped rather than rejected — a throw
   * here would be a 500 on a plain read.
   */
  it('canonicalizes a stored graph instead of rejecting its unpublished members', () => {
    const parsed = v2WorkflowGraphSchema.parse(STORED_GRAPH)

    expect(parsed.blocks['block-1']).not.toHaveProperty('layout')
    expect(parsed.edges[0]).not.toHaveProperty('animated')
    expect(parsed.variables['var-1']).not.toHaveProperty('workflowId')
    expect(parsed.blocks['block-1'].subBlocks['sub-1'].value).toBe('credential-1')
    expect(parsed.loops['loop-1'].iterations).toBe(3)
  })

  /** The round trip has to close: what the read emits is what the write accepts. */
  it('accepts its own output as a replacement body', () => {
    const parsed = v2WorkflowGraphSchema.parse(STORED_GRAPH)

    expect(v2ReplaceWorkflowStateBodySchema.safeParse(parsed).success).toBe(true)
  })

  it('rejects an unknown top-level member on the write body', () => {
    const parsed = v2WorkflowGraphSchema.parse(STORED_GRAPH)

    expect(
      v2ReplaceWorkflowStateBodySchema.safeParse({ ...parsed, lastSaved: Date.now() }).success
    ).toBe(false)
  })
})

describe('v2ApplyWorkflowOperationsDataSchema', () => {
  /** The published skip vocabulary is the engine's, so a new reason cannot ship undocumented. */
  it('publishes every reason the engine can decline an operation for', () => {
    for (const type of WORKFLOW_SKIPPED_ITEM_TYPES) {
      const result = v2ApplyWorkflowOperationsDataSchema.safeParse({
        id: 'workflow-1',
        warnings: [],
        needsRedeployment: false,
        applied: 0,
        skipped: [{ type, operationType: 'add', blockId: 'block-1', reason: 'because' }],
        deferred: [],
        inputValidationErrors: [],
        lint: { unresolvedReferences: [], notes: [] },
      })
      expect(result.success, `skip type ${type} is not published`).toBe(true)
    }
  })
})
