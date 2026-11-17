import { describe, expect, it } from 'vitest'
import { PlaneBlock } from '@/blocks/blocks/plane'
import type { BlockToolParamsContext } from '@/blocks/types'

function mapParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = PlaneBlock.tools.config?.params
  if (!mapper) throw new Error('Plane block has no params mapper')
  return { ...params, ...mapper(params, context) }
}

describe('Plane tool calls', () => {
  it('coerces the fields of the called operation, not List Projects', () => {
    const result = mapParams(
      { apiKey: 'k', workspace_slug: 'w', project_id: 'p', name: 'Sprint', sort_order: '5' },
      { operation: 'plane_create_cycle' }
    )
    expect(result.sort_order).toBe(5)
  })
})
