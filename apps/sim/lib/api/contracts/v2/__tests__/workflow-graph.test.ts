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

describe('the read shape tolerates what the write path never bounded', () => {
  /**
   * `workflow_blocks.name` and `.type` are bare `text()`, and the realtime
   * rename op accepts `z.string()`, so a block renamed past 255 characters on
   * the canvas is legal stored data. Asserting the input bound on the way out
   * made that workflow a `500` on the one endpoint that opens it — and since
   * `PUT /state` needs the `GET` round trip, unrepairable over v2.
   */
  it('reads a block whose stored name exceeds the write-side bound', () => {
    const longName = 'x'.repeat(300)
    const graph = structuredClone(STORED_GRAPH)
    graph.blocks['block-1'].name = longName

    expect(v2WorkflowGraphSchema.parse(graph).blocks['block-1'].name).toBe(longName)
  })

  it('still holds a write to the bound', () => {
    const body = {
      workspaceId: 'workspace-1',
      blocks: { 'block-1': { ...STORED_GRAPH.blocks['block-1'], name: 'x'.repeat(300) } },
      edges: [],
    }

    expect(v2ReplaceWorkflowStateBodySchema.safeParse(body).success).toBe(false)
  })
})

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

/** An empty report carrying every field the lint schema requires. */
const EMPTY_LINT = {
  sources: [],
  sinks: [],
  orphanBlocks: [],
  emptyOutgoingPorts: [],
  invalidBranchPorts: [],
  invalidConnectionTargets: [],
  fieldIssues: [],
  unresolvedReferences: [],
  tableFieldIssues: [],
  notes: [],
}

/** A report exercising every finding kind the lint schema publishes. */
const FULL_LINT = {
  sources: [{ blockId: 'block-1', blockName: 'Start', blockType: 'starter' }],
  sinks: [{ blockId: 'block-2', blockName: 'Triage', blockType: 'agent' }],
  orphanBlocks: [{ blockId: 'block-3', blockName: null, blockType: null }],
  emptyOutgoingPorts: [
    {
      blockId: 'loop-1',
      blockName: 'Loop',
      blockType: 'loop',
      handle: 'loop-start-source',
      label: 'loop-start-source',
    },
  ],
  invalidBranchPorts: [
    {
      blockId: 'cond-1',
      blockName: 'Check',
      blockType: 'condition',
      sourceHandle: 'condition-gone',
      reason: 'No such branch',
    },
  ],
  invalidConnectionTargets: [
    {
      sourceBlockId: 'block-1',
      sourceBlockName: 'Start',
      sourceHandle: null,
      targetBlockId: 'block-9',
      reason: 'Target is inside a container',
    },
  ],
  fieldIssues: [
    {
      blockId: 'block-2',
      blockName: 'Triage',
      blockType: 'agent',
      missingRequiredFields: ['systemPrompt'],
      inactiveModeValues: [
        {
          canonicalId: 'model',
          activeMemberId: 'model',
          inactiveMemberId: 'modelAdvanced',
          kind: 'other',
        },
      ],
    },
  ],
  unresolvedReferences: [
    {
      blockId: 'block-2',
      blockName: 'Triage',
      blockType: 'agent',
      field: 'credential',
      value: 'cred-9',
      kind: 'credential',
      reason: 'Not accessible',
    },
  ],
  tableFieldIssues: [
    {
      blockId: 'block-3',
      blockName: 'Query leads',
      blockType: 'table_v2',
      field: 'score',
      tableName: 'Leads',
    },
  ],
  notes: ['lint note'],
}

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
        mintedBlockIds: {},
        lint: EMPTY_LINT,
        dryRun: false,
      })
      expect(result.success, `skip type ${type} is not published`).toBe(true)
    }
  })

  /**
   * The lint report is what a headless builder acts on. Publishing only
   * `unresolvedReferences` dropped ~75% of it, `fieldIssues` — the blocks
   * missing a required field — most of all.
   */
  it('publishes every field of the lint report the use case produces', () => {
    const result = v2ApplyWorkflowOperationsDataSchema.safeParse({
      id: 'workflow-1',
      warnings: [],
      needsRedeployment: false,
      applied: 1,
      skipped: [],
      deferred: [],
      inputValidationErrors: [],
      mintedBlockIds: {},
      lint: FULL_LINT,
      dryRun: false,
    })

    expect(result.error?.issues ?? []).toEqual([])
    // The response schema is `.parse`d on the way out, so a field it does not
    // declare is silently stripped rather than rejected. Assert the parsed
    // output, not just that the input was accepted.
    expect(result.data?.lint).toEqual(FULL_LINT)
  })
})
