import { describe, expect, it } from 'vitest'
import { BufferBlock } from '@/blocks/blocks/buffer'

const mapper = BufferBlock.tools.config?.params
if (!mapper) throw new Error('BufferBlock has no params mapper')
const mapToolParams = mapper

describe('BufferBlock tool calls', () => {
  it('turns the default share mode into addToQueue when creating a post', () => {
    const merged = { apiKey: 'key', channelId: 'ch_1', text: 'Hello', mode: 'default' }
    const params: Record<string, unknown> = {
      ...merged,
      ...mapToolParams(merged, { operation: 'create_post' }),
    }

    expect(params.mode).toBe('addToQueue')
    expect(params.schedulingType).toBeUndefined()
  })
})
