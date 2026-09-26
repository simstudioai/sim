import type { BlockFactoryOptions } from '@sim/testing'
import { createAgentBlock, createBlock, createFunctionBlock, createLoopBlock } from '@sim/testing'
import type { Edge } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getBlock } from '@/blocks/registry'
import { normalizeName } from '@/executor/constants'
import { prepareBlockState } from './prepare-block-state'
import { filterNewEdges, getUniqueBlockName, regenerateBlockIds } from './utils'

describe('normalizeName', () => {
  it.concurrent('should handle edge cases', () => {
    expect(normalizeName('')).toBe('')
    expect(normalizeName('   ')).toBe('')
    expect(normalizeName('a')).toBe('a')
    expect(normalizeName('already_normalized')).toBe('already_normalized')
  })

  it.concurrent('should preserve non-space special characters except dots', () => {
    expect(normalizeName('my-variable')).toBe('my-variable')
    expect(normalizeName('my_variable')).toBe('my_variable')
  })

  it.concurrent('should strip dots since they conflict with the reference path delimiter', () => {
    expect(normalizeName('my.variable')).toBe('myvariable')
    expect(normalizeName('Trigger.dev 1')).toBe('triggerdev1')
    expect(normalizeName('Hunter.io 2')).toBe('hunterio2')
  })
})

describe('filterNewEdges', () => {
  const makeEdge = (id: string, sourceHandle: string, targetHandle: string): Edge => ({
    id,
    source: 'source',
    target: 'target',
    sourceHandle,
    targetHandle,
  })

  it('treats every side-anchored handle as the same logical connection', () => {
    const currentEdges = [makeEdge('canonical', 'source', 'target')]
    const candidates = [
      makeEdge('side-anchored', 'source-right', 'target-left'),
      makeEdge('other-side', 'source-left', 'target-right'),
      makeEdge('legacy-vertical', 'source-bottom', 'target-top'),
    ]

    expect(filterNewEdges(candidates, currentEdges)).toEqual([])
  })

  it('collapses side-anchored candidates against each other within one batch', () => {
    const candidates = [
      makeEdge('first', 'source-right', 'target-left'),
      makeEdge('second', 'source', 'target'),
    ]

    expect(filterNewEdges(candidates, [])).toEqual([candidates[0]])
  })

  it('keeps semantic routing handles distinct', () => {
    const currentEdges = [makeEdge('true-route', 'condition-true', 'target-left')]
    const candidates = [makeEdge('false-route', 'condition-false', 'target-left')]

    expect(filterNewEdges(candidates, currentEdges)).toEqual(candidates)
  })
})

describe('getUniqueBlockName', () => {
  it('should find highest number and increment', () => {
    const existingBlocks = {
      'block-1': createAgentBlock({ id: 'block-1', name: 'Agent 1' }),
      'block-2': createAgentBlock({ id: 'block-2', name: 'Agent 3' }),
      'block-3': createAgentBlock({ id: 'block-3', name: 'Agent 2' }),
    }

    expect(getUniqueBlockName('Agent', existingBlocks)).toBe('Agent 4')
  })

  it('should handle base name with existing number suffix', () => {
    const existingBlocks = {
      'block-1': createFunctionBlock({ id: 'block-1', name: 'Function 1' }),
      'block-2': createFunctionBlock({ id: 'block-2', name: 'Function 2' }),
    }

    expect(getUniqueBlockName('Function 1', existingBlocks)).toBe('Function 3')
    expect(getUniqueBlockName('Function 5', existingBlocks)).toBe('Function 3')
  })

  it('should be case insensitive when matching base names', () => {
    const existingBlocks = {
      'block-1': createBlock({ id: 'block-1', name: 'API 1' }),
      'block-2': createBlock({ id: 'block-2', name: 'api 2' }),
    }

    expect(getUniqueBlockName('API', existingBlocks)).toBe('API 3')
    expect(getUniqueBlockName('api', existingBlocks)).toBe('api 3')
  })

  it('should treat a bare existing name as the first of its series', () => {
    /* `Custom` is the first, so the next is `Custom 2` — not a second `Custom 1`. */
    const existingBlocks = {
      'block-1': createBlock({ id: 'block-1', name: 'Custom' }),
    }

    expect(getUniqueBlockName('Custom', existingBlocks)).toBe('Custom 2')
  })

  it('should continue a legacy series that starts at 1', () => {
    /* Workflows created before bare-first naming still number from 1; adding to
       one of those must not collide with its existing `Gmail 1`. */
    const existingBlocks = {
      'block-1': createBlock({ id: 'block-1', name: 'Gmail 1' }),
      'block-2': createBlock({ id: 'block-2', name: 'Gmail 2' }),
    }

    expect(getUniqueBlockName('Gmail', existingBlocks)).toBe('Gmail 3')
  })
})

describe('regenerateBlockIds', () => {
  const positionOffset = { x: 50, y: 50 }

  it('should preserve parentId and use same offset when duplicating a block inside an existing subflow', () => {
    const loopId = 'loop-1'
    const childId = 'child-1'

    const existingBlocks = {
      [loopId]: createLoopBlock({ id: loopId, name: 'Loop 1' }),
    }

    const blocksToCopy = {
      [childId]: createAgentBlock({
        id: childId,
        name: 'Agent 1',
        position: { x: 100, y: 50 },
        data: { parentId: loopId, extent: 'parent' },
      }),
    }

    const result = regenerateBlockIds(
      blocksToCopy,
      [],
      {},
      {},
      {},
      positionOffset, // { x: 50, y: 50 } - small offset, used as-is
      existingBlocks,
      getUniqueBlockName
    )

    const newBlocks = Object.values(result.blocks)
    expect(newBlocks).toHaveLength(1)

    const duplicatedBlock = newBlocks[0]
    expect(duplicatedBlock.data?.parentId).toBe(loopId)
    expect(duplicatedBlock.data?.extent).toBe('parent')
    expect(duplicatedBlock.position).toEqual({ x: 150, y: 100 })
  })

  it('should clear parentId when parent does not exist in paste set or existing blocks', () => {
    const nonExistentParentId = 'non-existent-loop'
    const childId = 'child-1'

    const blocksToCopy = {
      [childId]: createAgentBlock({
        id: childId,
        name: 'Agent 1',
        position: { x: 100, y: 50 },
        data: { parentId: nonExistentParentId, extent: 'parent' },
      }),
    }

    const result = regenerateBlockIds(
      blocksToCopy,
      [],
      {},
      {},
      {},
      positionOffset,
      {},
      getUniqueBlockName
    )

    const newBlocks = Object.values(result.blocks)
    expect(newBlocks).toHaveLength(1)

    const duplicatedBlock = newBlocks[0]
    expect(duplicatedBlock.data?.parentId).toBeUndefined()
    expect(duplicatedBlock.data?.extent).toBeUndefined()
  })

  it('should remap parentId when copying both parent and child together', () => {
    const loopId = 'loop-1'
    const childId = 'child-1'

    const blocksToCopy = {
      [loopId]: createLoopBlock({
        id: loopId,
        name: 'Loop 1',
        position: { x: 200, y: 200 },
      }),
      [childId]: createAgentBlock({
        id: childId,
        name: 'Agent 1',
        position: { x: 100, y: 50 },
        data: { parentId: loopId, extent: 'parent' },
      }),
    }

    const result = regenerateBlockIds(
      blocksToCopy,
      [],
      {},
      {},
      {},
      positionOffset,
      {},
      getUniqueBlockName
    )

    const newBlocks = Object.values(result.blocks)
    expect(newBlocks).toHaveLength(2)

    const newLoop = newBlocks.find((b) => b.type === 'loop')
    const newChild = newBlocks.find((b) => b.type === 'agent')

    expect(newLoop).toBeDefined()
    expect(newChild).toBeDefined()
    expect(newChild!.data?.parentId).toBe(newLoop!.id)
    expect(newChild!.data?.extent).toBe('parent')

    expect(newLoop!.position).toEqual({ x: 250, y: 250 })
    expect(newChild!.position).toEqual({ x: 100, y: 50 })
  })

  it('should ignore large viewport offset for blocks inside existing subflows', () => {
    const loopId = 'loop-1'
    const childId = 'child-1'

    const existingBlocks = {
      [loopId]: createLoopBlock({ id: loopId, name: 'Loop 1' }),
    }

    const blocksToCopy = {
      [childId]: createAgentBlock({
        id: childId,
        name: 'Agent 1',
        position: { x: 100, y: 50 },
        data: { parentId: loopId, extent: 'parent' },
      }),
    }

    const largeViewportOffset = { x: 2000, y: 1500 }

    const result = regenerateBlockIds(
      blocksToCopy,
      [],
      {},
      {},
      {},
      largeViewportOffset,
      existingBlocks,
      getUniqueBlockName
    )

    const duplicatedBlock = Object.values(result.blocks)[0]
    expect(duplicatedBlock.position).toEqual({ x: 280, y: 70 })
    expect(duplicatedBlock.data?.parentId).toBe(loopId)
  })

  /**
   * Regression: a fallback writer stamped a condition block's `conditions`
   * subblock `short-input`. The id remap must key on block type + subblock key
   * (not the drifted stored type) so the condition row ids and the outgoing
   * edge's sourceHandle move together — previously the handle remapped while
   * the row ids stayed stale, orphaning the edge.
   */
  it('keeps condition row ids and edge handles consistent when the stored subblock type drifted', () => {
    const conditionId = 'condition-1'
    const targetId = 'target-1'

    const blocksToCopy = {
      [conditionId]: createBlock({
        id: conditionId,
        type: 'condition',
        name: 'botFilter',
        subBlocks: {
          conditions: {
            id: 'conditions',
            type: 'short-input',
            value: JSON.stringify([
              { id: `${conditionId}-if`, title: 'if', value: '<a.b>' },
              { id: `${conditionId}-else`, title: 'else', value: '' },
            ]),
          },
        },
      }),
      [targetId]: createAgentBlock({ id: targetId, name: 'Agent 1' }),
    }

    const edges = [
      {
        id: 'edge-1',
        source: conditionId,
        sourceHandle: `condition-${conditionId}-else`,
        target: targetId,
        targetHandle: 'target',
      },
    ] as Edge[]

    const result = regenerateBlockIds(
      blocksToCopy,
      edges,
      {},
      {},
      {},
      positionOffset,
      {},
      getUniqueBlockName
    )

    const newCondition = Object.values(result.blocks).find((b) => b.type === 'condition')!
    const newEdge = result.edges[0]
    const rowIds = JSON.parse(newCondition.subBlocks.conditions.value as string).map(
      (row: { id: string }) => row.id
    )

    expect(rowIds).toEqual([`${newCondition.id}-if`, `${newCondition.id}-else`])
    expect(newEdge.sourceHandle).toBe(`condition-${newCondition.id}-else`)
  })

  it('should unlock pasted block when source is locked', () => {
    const blockId = 'block-1'

    const blocksToCopy = {
      [blockId]: createAgentBlock({
        id: blockId,
        name: 'Locked Agent',
        position: { x: 100, y: 50 },
        locked: true,
      }),
    }

    const result = regenerateBlockIds(
      blocksToCopy,
      [],
      {},
      {},
      {},
      positionOffset,
      {},
      getUniqueBlockName
    )

    const newBlocks = Object.values(result.blocks)
    expect(newBlocks).toHaveLength(1)

    // Pasted blocks are always unlocked so users can edit them
    const pastedBlock = newBlocks[0]
    expect(pastedBlock.locked).toBe(false)
  })

  it('should increment name when an exact match exists in destination', () => {
    const existingBlocks = {
      existing: createAgentBlock({ id: 'existing', name: 'Agent 1' }),
    }

    const blocksToCopy = {
      'block-1': createAgentBlock({
        id: 'block-1',
        name: 'Agent 1',
        position: { x: 100, y: 100 },
      }),
    }

    const result = regenerateBlockIds(
      blocksToCopy,
      [],
      {},
      {},
      {},
      positionOffset,
      existingBlocks,
      getUniqueBlockName
    )

    expect(Object.values(result.blocks)[0].name).toBe('Agent 2')
  })

  it('should preserve name when only a different-numbered sibling exists', () => {
    const existingBlocks = {
      existing: createAgentBlock({ id: 'existing', name: 'Agent 2' }),
    }

    const blocksToCopy = {
      'block-1': createAgentBlock({
        id: 'block-1',
        name: 'Agent 5',
        position: { x: 100, y: 100 },
      }),
    }

    const result = regenerateBlockIds(
      blocksToCopy,
      [],
      {},
      {},
      {},
      positionOffset,
      existingBlocks,
      getUniqueBlockName
    )

    expect(Object.values(result.blocks)[0].name).toBe('Agent 5')
  })

  it('should avoid collisions between pasted blocks themselves', () => {
    const blocksToCopy = {
      'block-1': createAgentBlock({
        id: 'block-1',
        name: 'Agent 1',
        position: { x: 100, y: 100 },
      }),
      'block-2': createAgentBlock({
        id: 'block-2',
        name: 'Agent 1',
        position: { x: 200, y: 100 },
      }),
    }

    const result = regenerateBlockIds(
      blocksToCopy,
      [],
      {},
      {},
      {},
      positionOffset,
      {},
      getUniqueBlockName
    )

    const newBlocks = Object.values(result.blocks)
    const names = newBlocks.map((b) => b.name)

    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)
    expect(names).toContain('Agent 1')
    expect(names).toContain('Agent 2')
  })
})

describe('regenerateBlockIds — cloned webhook path', () => {
  const positionOffset = { x: 50, y: 50 }
  const sourceId = 'webhook-source'
  const deployedPath = 'webhook-source'

  function pasteOne(block: Partial<BlockFactoryOptions>, values?: Record<string, unknown>) {
    const blocks = { [sourceId]: createBlock({ id: sourceId, ...block }) }
    const result = regenerateBlockIds(
      blocks,
      [],
      {},
      {},
      values ? { [sourceId]: values } : {},
      positionOffset,
      {},
      getUniqueBlockName
    )
    return { newId: Object.keys(result.blocks)[0], result }
  }

  /**
   * The reported bug. A Webhook Trigger added from the toolbar carries `triggerMode: true`
   * (confirmed against production rows), and after a deploy its `triggerPath` holds the registered
   * path — its own block id. A clone that copies that value renders the SOURCE's URL.
   */
  it('clears triggerPath on a pasted webhook trigger (triggerMode true)', () => {
    const { newId, result } = pasteOne(
      {
        type: 'generic_webhook',
        name: 'Webhook 1',
        triggerMode: true,
        subBlocks: {
          triggerPath: { id: 'triggerPath', type: 'short-input', value: deployedPath },
        },
      },
      { triggerPath: deployedPath }
    )

    expect(newId).not.toBe(sourceId)
    // Both sources must be cleared: the value map overrides the structure in mergeSubblockState.
    expect(result.blocks[newId].subBlocks.triggerPath?.value).toBeNull()
    expect(result.subBlockValues[newId].triggerPath).toBeNull()
  })

  /**
   * `webhookId` is a user-entered action field on Attio, Vercel, and Discord — and Attio/Vercel are
   * trigger-capable, so any predicate keyed on trigger-ness would wipe it in trigger mode. It is
   * deliberately NOT cleared: nothing reads it as trigger state.
   */
  it('preserves a user-entered webhookId on a trigger-capable block in trigger mode', () => {
    const { newId, result } = pasteOne(
      {
        type: 'attio',
        name: 'Attio 1',
        triggerMode: true,
        subBlocks: {
          webhookId: { id: 'webhookId', type: 'short-input', value: 'attio-wh-42' },
        },
      },
      { webhookId: 'attio-wh-42' }
    )

    expect(result.blocks[newId].subBlocks.webhookId?.value).toBe('attio-wh-42')
    expect(result.subBlockValues[newId].webhookId).toBe('attio-wh-42')
  })

  /** Trigger configuration is user setup and must survive the copy. */
  it('preserves trigger configuration on a cloned trigger block', () => {
    const { newId, result } = pasteOne(
      {
        type: 'generic_webhook',
        name: 'Webhook 1',
        triggerMode: true,
        subBlocks: {
          triggerPath: { id: 'triggerPath', type: 'short-input', value: deployedPath },
          triggerConfig: { id: 'triggerConfig', type: 'short-input', value: { labelIds: ['a'] } },
          triggerId: { id: 'triggerId', type: 'short-input', value: 'generic_webhook' },
          token: { id: 'token', type: 'short-input', value: 'user-secret' },
        },
      },
      {
        triggerPath: deployedPath,
        triggerConfig: { labelIds: ['a'] },
        triggerId: 'generic_webhook',
        token: 'user-secret',
      }
    )

    expect(result.subBlockValues[newId].triggerPath).toBeNull()
    expect(result.subBlockValues[newId].triggerConfig).toEqual({ labelIds: ['a'] })
    expect(result.subBlockValues[newId].triggerId).toBe('generic_webhook')
    expect(result.subBlockValues[newId].token).toBe('user-secret')
  })
})

describe('prepareBlockState — permission-group seed veto', () => {
  const blockWithDefaults = {
    name: 'Mock Block',
    description: '',
    icon: () => null,
    outputs: {},
    tools: { access: ['slack_message'] },
    subBlocks: [
      { id: 'operation', type: 'dropdown', defaultValue: 'send' },
      { id: 'model', type: 'combobox', defaultValue: 'claude-sonnet-5' },
      { id: 'channel', type: 'short-input', defaultValue: '#general' },
      { id: 'blank', type: 'short-input', defaultValue: '' },
      { id: 'headers', type: 'table', defaultValue: [] },
    ],
  }

  const seededValues = (isSeededValueAllowed?: (subBlockId: string, value: string) => boolean) => {
    vi.mocked(getBlock).mockReturnValueOnce(blockWithDefaults as never)
    const block = prepareBlockState({
      id: 'b1',
      type: 'slack',
      name: 'Slack',
      position: { x: 0, y: 0 },
      isSeededValueAllowed,
    })
    return Object.fromEntries(
      Object.entries(block.subBlocks).map(([id, subBlock]) => [id, subBlock.value])
    )
  }

  afterEach(() => {
    vi.mocked(getBlock).mockReset()
  })

  it('keeps an empty or non-string default even when the gate rejects everything', () => {
    const values = seededValues(() => false)
    expect(values.blank).toBe('')
    expect(values.headers).toEqual([])
  })

  it('leaves a denied operation unseeded rather than substituting one', () => {
    const values = seededValues((subBlockId) => subBlockId !== 'operation')
    expect(values.operation).toBeNull()
    expect(values.model).toBe('claude-sonnet-5')
    expect(values.channel).toBe('#general')
  })

  it('passes the seeded value to the gate, not just the field id', () => {
    const seen: Array<[string, string]> = []
    seededValues((subBlockId, value) => {
      seen.push([subBlockId, value])
      return true
    })
    expect(seen).toEqual([
      ['operation', 'send'],
      ['model', 'claude-sonnet-5'],
      ['channel', '#general'],
    ])
  })
})
