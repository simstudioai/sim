import { describe, expect, it } from 'vitest'
import { ApiBlock } from '@/blocks/blocks/api'

describe('API block', () => {
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

  it('marks the request body as JSON for code previews', () => {
    const body = ApiBlock.subBlocks.find((subBlock) => subBlock.id === 'body')

    expect(body?.type).toBe('code')
    expect(body?.language).toBe('json')
  })
})
