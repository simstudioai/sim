import { describe, expect, it } from 'vitest'
import {
  BLOCKS_OPERATIONS,
  EDGES_OPERATIONS,
  OPERATION_TARGETS,
  SUBBLOCK_OPERATIONS,
} from './constants'
import { WorkflowOperationSchema } from './schemas'

const position = { x: 0, y: 0 }
const edge = { id: 'e', source: 'a', target: 'b' }
const many = <T>(count: number, entry: T) => Array.from({ length: count }, () => entry)

/** Each batch frame with `count` entries in its capped array, and the cap it must hold to. */
const batches: Array<{
  operation: string
  field: string
  target: string
  cap: number
  payload: (count: number) => object
}> = [
  {
    operation: BLOCKS_OPERATIONS.BATCH_UPDATE_POSITIONS,
    field: 'updates',
    target: OPERATION_TARGETS.BLOCKS,
    cap: 2_000,
    payload: (n) => ({ updates: many(n, { id: 'b', position }) }),
  },
  {
    operation: BLOCKS_OPERATIONS.BATCH_ADD_BLOCKS,
    field: 'blocks',
    target: OPERATION_TARGETS.BLOCKS,
    cap: 2_000,
    payload: (n) => ({ blocks: many(n, { id: 'b' }) }),
  },
  {
    operation: BLOCKS_OPERATIONS.BATCH_ADD_BLOCKS,
    field: 'edges',
    target: OPERATION_TARGETS.BLOCKS,
    cap: 10_000,
    payload: (n) => ({ blocks: [], edges: many(n, edge) }),
  },
  {
    operation: BLOCKS_OPERATIONS.BATCH_REMOVE_BLOCKS,
    field: 'ids',
    target: OPERATION_TARGETS.BLOCKS,
    cap: 2_000,
    payload: (n) => ({ ids: many(n, 'b') }),
  },
  ...[
    BLOCKS_OPERATIONS.BATCH_TOGGLE_ENABLED,
    BLOCKS_OPERATIONS.BATCH_TOGGLE_HANDLES,
    BLOCKS_OPERATIONS.BATCH_TOGGLE_LOCKED,
  ].map((operation) => ({
    operation,
    field: 'blockIds',
    target: OPERATION_TARGETS.BLOCKS,
    cap: 2_000,
    payload: (n: number) => ({
      blockIds: many(n, 'b'),
      previousStates: {},
    }),
  })),
  {
    operation: BLOCKS_OPERATIONS.BATCH_UPDATE_PARENT,
    field: 'updates',
    target: OPERATION_TARGETS.BLOCKS,
    cap: 2_000,
    payload: (n) => ({
      updates: many(n, { id: 'b', parentId: 'p', position }),
    }),
  },
  {
    operation: EDGES_OPERATIONS.BATCH_ADD_EDGES,
    field: 'edges',
    target: OPERATION_TARGETS.EDGES,
    cap: 10_000,
    payload: (n) => ({ edges: many(n, edge) }),
  },
  {
    operation: EDGES_OPERATIONS.BATCH_REMOVE_EDGES,
    field: 'ids',
    target: OPERATION_TARGETS.EDGES,
    cap: 10_000,
    payload: (n) => ({ ids: many(n, 'e') }),
  },
  {
    operation: SUBBLOCK_OPERATIONS.BATCH_UPDATE,
    field: 'updates',
    target: OPERATION_TARGETS.SUBBLOCK,
    cap: 10_000,
    payload: (n) => ({
      updates: many(n, { blockId: 'b', subblockId: 's', value: 1 }),
    }),
  },
]

describe('WorkflowOperationSchema batch caps', () => {
  it.each(batches)(
    'caps $operation $field at $cap entries',
    ({ operation, target, cap, payload }) => {
      const frame = (count: number) => ({
        operation,
        target,
        payload: payload(count),
        timestamp: 1,
      })
      expect(WorkflowOperationSchema.safeParse(frame(cap)).success).toBe(true)
      expect(WorkflowOperationSchema.safeParse(frame(cap + 1)).success).toBe(false)
    }
  )
})
