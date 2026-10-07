import { describe, expect, it } from 'vitest'
import { isPausingStopTarget } from '@/executor/utils/stop-after'
import type { SerializedBlock } from '@/serializer/types'

function block(id: string, type: string): SerializedBlock {
  return {
    id,
    position: { x: 0, y: 0 },
    config: { tool: type, params: {} },
    inputs: {},
    outputs: {},
    metadata: { id: type, name: id },
    enabled: true,
  }
}

describe('isPausingStopTarget', () => {
  it.each(['human_in_the_loop', 'human_in_the_loop_v2', 'wait'])(
    'rejects a %s stop target',
    (type) => {
      expect(isPausingStopTarget([block('b1', type)], 'b1')).toBe(true)
    }
  )

  it.each(['function', 'agent', 'condition', 'loop', 'parallel'])(
    'allows a %s stop target',
    (type) => {
      expect(isPausingStopTarget([block('b1', type)], 'b1')).toBe(false)
    }
  )

  it('allows an unknown block id', () => {
    expect(isPausingStopTarget([block('b1', 'function')], 'missing')).toBe(false)
  })
})
