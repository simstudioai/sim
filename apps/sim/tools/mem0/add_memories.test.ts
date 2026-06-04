/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { mem0AddMemoriesTool } from '@/tools/mem0/add_memories'
import type { Mem0AddMemoriesParams } from '@/tools/mem0/types'

describe('mem0AddMemoriesTool', () => {
  const buildBody = mem0AddMemoriesTool.request.body!
  const transformResponse = mem0AddMemoriesTool.transformResponse!

  it('uses the v3 add memories endpoint', () => {
    expect(mem0AddMemoriesTool.request.url).toBe('https://api.mem0.ai/v3/memories/add/')
    expect(mem0AddMemoriesTool.request.method).toBe('POST')
  })

  it('builds the documented add memories request body', () => {
    const body = buildBody({
      apiKey: 'test-key',
      userId: ' alice ',
      messages: [{ role: 'user', content: 'I like Sim.' }],
    })

    expect(body).toEqual({
      messages: [{ role: 'user', content: 'I like Sim.' }],
      user_id: 'alice',
    })
  })

  it('accepts JSON string messages from the block code input', () => {
    const params: Mem0AddMemoriesParams = {
      apiKey: 'test-key',
      userId: 'alice',
      messages: JSON.stringify([{ role: 'assistant', content: 'I will remember that.' }]),
    }

    expect(buildBody(params)).toEqual({
      messages: [{ role: 'assistant', content: 'I will remember that.' }],
      user_id: 'alice',
    })
  })

  it('rejects unsupported message roles before building the request body', () => {
    expect(() =>
      buildBody({
        apiKey: 'test-key',
        userId: 'alice',
        messages: JSON.stringify([{ role: 'system', content: 'Remember this.' }]),
      })
    ).toThrow('Each message must have role user or assistant and non-empty content')
  })

  it('extracts queued processing fields from v3 responses', async () => {
    const result = await transformResponse(
      new Response(
        JSON.stringify({
          message: 'Memory processing has been queued for background execution',
          status: 'PENDING',
          event_id: 'evt-123',
        })
      )
    )

    expect(result).toEqual({
      success: true,
      output: {
        message: 'Memory processing has been queued for background execution',
        status: 'PENDING',
        event_id: 'evt-123',
      },
    })
  })
})
