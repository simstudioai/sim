import type { BlockState } from '@sim/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import { convertLoopBlockToLoop } from './subflow-helpers'

describe('convertLoopBlockToLoop', () => {
  it.concurrent('should keep string as-is if not valid JSON', () => {
    const blocks: Record<string, BlockState> = {
      loop1: {
        id: 'loop1',
        type: 'loop',
        name: 'Test Loop',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: { loopType: 'forEach', count: 5, collection: '<blockName.items>' },
      },
    }

    const result = convertLoopBlockToLoop('loop1', blocks)

    expect(result).toBeDefined()
    expect(result?.forEachItems).toBe('<blockName.items>')
  })
})
