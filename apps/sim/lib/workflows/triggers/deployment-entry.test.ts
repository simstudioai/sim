import { createBlock } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import { resolveDeploymentTriggerBlockId } from '@/lib/workflows/triggers/deployment-entry'
import type { BlockState } from '@/stores/workflows/workflow/types'

function blocks(...types: string[]): Record<string, BlockState> {
  return Object.fromEntries(
    types.map((type, index) => [`block-${index}`, createBlock({ id: `block-${index}`, type })])
  )
}

describe('deployed workflow entry selection', () => {
  it.each([
    'schedule',
    'starter',
    'start_trigger',
    'api_trigger',
    'manual_trigger',
    'chat_trigger',
  ])('resolves the sole enabled %s entry', (type) => {
    expect(resolveDeploymentTriggerBlockId(blocks(type, 'function'))).toBe('block-0')
  })

  it('preserves an unambiguous API entry in a mixed deployment', () => {
    expect(resolveDeploymentTriggerBlockId(blocks('schedule', 'api_trigger', 'chat_trigger'))).toBe(
      'block-1'
    )
  })

  it('allows an explicit Schedule entry and rejects non-trigger selections', () => {
    const graph = blocks('schedule', 'api_trigger', 'function')
    expect(resolveDeploymentTriggerBlockId(graph, 'block-0')).toBe('block-0')
    expect(() => resolveDeploymentTriggerBlockId(graph, 'block-2')).toThrow('Available triggers:')
    expect(() => resolveDeploymentTriggerBlockId(graph, 'draft-only')).toThrow('active deployment')
  })

  it.each([
    ['schedule', 'schedule'],
    ['api_trigger', 'api_trigger'],
  ])('rejects ambiguous %j entries before execution with an actionable selector', (...types) => {
    expect(() => resolveDeploymentTriggerBlockId(blocks(...types))).toThrow('Set run.entry')
  })

  it('excludes disabled triggers and reports no runnable deployment', () => {
    const graph = blocks('schedule', 'function')
    graph['block-0'].enabled = false
    expect(() => resolveDeploymentTriggerBlockId(graph)).toThrow('no enabled runnable trigger')
    expect(() => resolveDeploymentTriggerBlockId(graph, 'block-0')).toThrow(
      'not an enabled trigger'
    )
  })
})
