import { describe, expect, it } from 'vitest'
import { PipedriveBlock } from '@/blocks/blocks/pipedrive'

describe('Pipedrive deal status defaults', () => {
  const status = PipedriveBlock.subBlocks.find(
    (subBlock) =>
      subBlock.id === 'status' &&
      typeof subBlock.options === 'function' &&
      subBlock.condition !== undefined &&
      JSON.stringify(subBlock.condition).includes('update_deal')
  )

  it('leads with No change everywhere except a known Create Deal', () => {
    const options = status?.options
    if (typeof options !== 'function') throw new Error('deal status options are static')
    expect(options({ values: {} })[0]?.id).toBe('')
    expect(options({ values: { operation: 'update_deal' } })[0]?.id).toBe('')
    expect(options({ values: { operation: 'create_deal' } })[0]?.id).toBe('open')
    expect(options()[0]?.id).toBe('open')
  })
})
