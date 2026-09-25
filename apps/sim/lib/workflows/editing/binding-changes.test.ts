/** @vitest-environment node */
import type { BlockState } from '@sim/workflow-types/workflow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { collectRemovedWorkflowBindings } from '@/lib/workflows/editing/binding-changes'
import { getBlock } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'

const config = {
  subBlocks: [
    { id: 'credential', type: 'oauth-input' },
    { id: 'apiKey', type: 'short-input', password: true },
    { id: 'tableSelector', type: 'table-selector', canonicalParamId: 'tableId', mode: 'basic' },
    { id: 'manualTableId', type: 'short-input', canonicalParamId: 'tableId', mode: 'advanced' },
  ],
} as BlockConfig

function block(values: Record<string, string | null>): BlockState {
  return {
    id: 'block',
    type: 'table_v2',
    name: 'Bound block',
    enabled: true,
    position: { x: 0, y: 0 },
    outputs: {},
    subBlocks: Object.fromEntries(
      Object.entries(values).map(([id, value]) => [
        id,
        { id, type: config.subBlocks.find((field) => field.id === id)!.type, value },
      ])
    ),
  }
}

beforeEach(() => vi.mocked(getBlock).mockReturnValue(config))

describe('binding removal preview', () => {
  it('reports removed credential/table identifiers without copying secret values', () => {
    const previous = {
      block: block({
        credential: 'credential-1',
        tableSelector: 'table-1',
        apiKey: 'PRIVATE-API-KEY',
      }),
    }
    const result = collectRemovedWorkflowBindings(previous, {
      block: block({ credential: null, tableSelector: null, apiKey: null }),
    })
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blockId: 'block',
          kind: 'credential',
          resourceId: 'credential-1',
          field: 'credential',
        }),
        expect.objectContaining({
          blockId: 'block',
          kind: 'table',
          resourceId: 'table-1',
          field: 'tableSelector',
        }),
      ])
    )
    expect(result).toHaveLength(2)
    expect(JSON.stringify(result)).not.toContain('PRIVATE-API-KEY')
    expect(previous.block.subBlocks.apiKey.value).toBe('PRIVATE-API-KEY')
  })

  it('reports lost bindings when a block is removed or its ID changes', () => {
    const previous = { block: block({ credential: 'credential-1' }) }
    expect(collectRemovedWorkflowBindings(previous, {})).toHaveLength(1)
    expect(
      collectRemovedWorkflowBindings(previous, { other: { ...previous.block, id: 'other' } })
    ).toHaveLength(1)
  })

  it('retains unchanged bindings and identifies replaced resource IDs', () => {
    const previous = { block: block({ credential: 'credential-1', tableSelector: 'table-1' }) }
    expect(collectRemovedWorkflowBindings(previous, structuredClone(previous))).toEqual([])
    expect(
      collectRemovedWorkflowBindings(previous, {
        block: block({ credential: 'credential-1', tableSelector: 'table-2' }),
      })
    ).toEqual([expect.objectContaining({ kind: 'table', resourceId: 'table-1' })])
  })
})
