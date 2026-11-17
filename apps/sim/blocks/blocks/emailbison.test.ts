import { describe, expect, it } from 'vitest'
import { EmailBisonBlock } from '@/blocks/blocks/emailbison'

describe('Email Bison agent tool calls', () => {
  it('keeps the model reply filters for List Replies', () => {
    const mapper = EmailBisonBlock.tools.config?.params
    if (!mapper) throw new Error('Email Bison block has no params mapper')

    const result = mapper(
      { apiKey: 'key', status: 'interested', leadId: 7, tagIds: [3, 4] },
      { operation: 'list_replies' }
    )

    expect(result).toMatchObject({ status: 'interested', leadId: 7, tagIds: [3, 4] })
  })

  it('keeps the model tag name for Create Tag', () => {
    const mapper = EmailBisonBlock.tools.config?.params
    if (!mapper) throw new Error('Email Bison block has no params mapper')

    const result = mapper({ apiKey: 'key', name: 'VIP' }, { operation: 'create_tag' })

    expect(result.name).toBe('VIP')
  })
})
