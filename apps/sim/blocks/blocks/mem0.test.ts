/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { Mem0Block } from '@/blocks/blocks/mem0'

describe('Mem0Block', () => {
  const buildParams = Mem0Block.tools.config.params!

  it('parses JSON string messages for add operations', () => {
    const params = buildParams({
      operation: 'add',
      apiKey: 'test-key',
      userId: 'alice',
      messages: JSON.stringify([{ role: 'user', content: 'I like Sim.' }]),
    })

    expect(params).toEqual({
      apiKey: 'test-key',
      userId: 'alice',
      messages: [{ role: 'user', content: 'I like Sim.' }],
    })
  })

  it('rejects unsupported message roles before execution', () => {
    expect(() =>
      buildParams({
        operation: 'add',
        apiKey: 'test-key',
        userId: 'alice',
        messages: JSON.stringify([{ role: 'system', content: 'Remember this.' }]),
      })
    ).toThrow('Each message must have role user or assistant and non-empty content')
  })

  it('passes pagination params for get operations', () => {
    const params = buildParams({
      operation: 'get',
      apiKey: 'test-key',
      userId: 'alice',
      page: '2',
      limit: '25',
    })

    expect(params).toEqual({
      apiKey: 'test-key',
      userId: 'alice',
      page: 2,
      limit: 25,
    })
  })
})
