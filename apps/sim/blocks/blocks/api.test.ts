import { describe, expect, it } from 'vitest'
import { ApiBlock } from '@/blocks/blocks/api'

describe('API block redirect policy', () => {
  it('uses a versioned safe default without changing legacy blocks', () => {
    const version = ApiBlock.subBlocks.find((subBlock) => subBlock.id === 'redirectPolicyVersion')
    const sendCredentials = ApiBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'sendCredentialsOnCrossOriginRedirect'
    )

    expect(version?.hidden).toBe(true)
    expect(version?.defaultValue).toBe('standard-v1')
    expect(sendCredentials?.type).toBe('switch')
    expect(sendCredentials?.mode).toBe('advanced')
    expect(sendCredentials?.defaultValue).toBe(true)
  })
})
