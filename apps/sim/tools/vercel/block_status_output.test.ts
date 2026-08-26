/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { VercelBlock } from '@/blocks/blocks/vercel'

describe('vercel block outputs', () => {
  it('surfaces the status returned by update_edge_config_items', () => {
    const status = VercelBlock.outputs.status
    expect(status).toBeDefined()
    expect(status.type).toBe('string')
    expect(status.condition).toEqual({
      field: 'operation',
      value: ['update_edge_config_items'],
    })
  })
})
