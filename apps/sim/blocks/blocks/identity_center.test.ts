import { describe, expect, it } from 'vitest'
import { IdentityCenterBlock } from '@/blocks/blocks/identity_center'
import type { BlockToolParamsContext } from '@/blocks/types'

function mapParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = IdentityCenterBlock.tools.config?.params
  if (!mapper) throw new Error('Identity Center block has no params mapper')
  return mapper(params, context)
}

describe('Identity Center list_account_assignments tool calls', () => {
  it('keeps the model accountId when no account filter is stored', () => {
    const mapped = mapParams(
      { instanceArn: 'arn:i', principalId: 'u1', principalType: 'USER', accountId: '222' },
      { operation: 'list_account_assignments' }
    )

    expect(mapped.accountId).toBe('222')
  })
})
