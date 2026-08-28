/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { memoryGetTool } from '@/tools/memory/get'

describe('memoryGetTool', () => {
  const buildInput = memoryGetTool.operation.input
  const transformResponse = memoryGetTool.transformResponse!

  it('builds an exact semantic memory lookup input', () => {
    const input = buildInput({
      conversationId: 'user-123',
    })

    expect(input).toEqual({ id: 'user-123' })
  })

  it('preserves legacy id values without transport encoding', () => {
    const input = buildInput({
      id: 'team/user 123',
    })

    expect(input).toEqual({ id: 'team/user 123' })
  })

  it('returns empty memories when key is not found (null data)', async () => {
    const result = await transformResponse(
      new Response(JSON.stringify({ success: true, data: null }))
    )

    expect(result).toEqual({
      success: true,
      output: {
        memories: [],
        message: 'No memories found',
      },
    })
  })

  it('wraps the exact memory response as a single result', async () => {
    const result = await transformResponse(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            conversationId: 'user-123',
            data: [{ role: 'user', content: 'Remember this' }],
          },
        })
      )
    )

    expect(result).toEqual({
      success: true,
      output: {
        memories: [
          {
            conversationId: 'user-123',
            data: [{ role: 'user', content: 'Remember this' }],
          },
        ],
        message: 'Found 1 memory',
      },
    })
  })
})
