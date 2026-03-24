/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { BlockState } from '@/stores/workflows/workflow/types'
import {
  collectDynamicHandleTopologySignatures,
  getChangedDynamicHandleBlockIds,
  getConditionRows,
  getDynamicHandleTopologySignature,
  getRouterRows,
} from './dynamic-handle-topology'

describe('dynamic handle topology', () => {
  it('falls back to canonical condition rows when value is empty', () => {
    expect(getConditionRows('condition-1', null)).toEqual([
      { id: 'condition-1-if', title: 'if', value: '' },
      { id: 'condition-1-else', title: 'else', value: '' },
    ])
  })

  it('falls back to canonical router rows when value is empty', () => {
    expect(getRouterRows('router-1', null)).toEqual([{ id: 'router-1-route1', value: '' }])
  })

  it('builds topology signatures from condition ids', () => {
    const block = {
      id: 'condition-1',
      type: 'condition',
      subBlocks: {
        conditions: {
          id: 'conditions',
          type: 'condition-input',
          value: JSON.stringify([
            { id: 'condition-1-if', title: 'if', value: 'true' },
            { id: 'condition-1-else', title: 'else', value: '' },
          ]),
        },
      },
    } as BlockState

    expect(getDynamicHandleTopologySignature(block)).toBe(
      'condition:condition-1-if|condition-1-else'
    )
  })

  it('detects topology changes only for changed dynamic-handle blocks', () => {
    const previous = new Map<string, string>([
      ['condition-1', 'condition:condition-1-if|condition-1-else'],
    ])
    const nextBlocks = {
      'condition-1': {
        id: 'condition-1',
        type: 'condition',
        name: 'Condition 1',
        position: { x: 0, y: 0 },
        enabled: true,
        subBlocks: {
          conditions: {
            id: 'conditions',
            type: 'condition-input',
            value: JSON.stringify([
              { id: 'condition-1-if', title: 'if', value: 'true' },
              { id: 'condition-1-else-if-0', title: 'else if', value: 'false' },
              { id: 'condition-1-else', title: 'else', value: '' },
            ]),
          },
        },
        outputs: {},
      },
      'function-1': {
        id: 'function-1',
        type: 'function',
        name: 'Function 1',
        position: { x: 0, y: 0 },
        enabled: true,
        subBlocks: {},
        outputs: {},
      },
    } as Record<string, BlockState>

    const next = collectDynamicHandleTopologySignatures(nextBlocks)
    expect(getChangedDynamicHandleBlockIds(previous, next)).toEqual(['condition-1'])
  })
})
