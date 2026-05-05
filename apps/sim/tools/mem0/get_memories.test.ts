/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { mem0GetMemoriesTool } from '@/tools/mem0/get_memories'

interface Mem0GetParams {
  apiKey: string
  userId?: string
  memoryId?: string
  startDate?: string
  endDate?: string
  page?: number
  limit?: number
}

describe('mem0GetMemoriesTool', () => {
  const buildUrl = mem0GetMemoriesTool.request.url as (params: Mem0GetParams) => string
  const buildMethod = mem0GetMemoriesTool.request.method as (params: Mem0GetParams) => string
  const buildBody = mem0GetMemoriesTool.request.body!
  const transformResponse = mem0GetMemoriesTool.transformResponse!

  it('uses scoped v3 list memories requests', () => {
    const params = {
      apiKey: 'test-key',
      userId: 'user-123',
      page: 3,
      limit: 25,
    }

    expect(buildUrl(params)).toBe('https://api.mem0.ai/v3/memories/')
    expect(buildMethod(params)).toBe('POST')
    expect(buildBody(params)).toEqual({
      filters: {
        user_id: 'user-123',
      },
      page: 3,
      page_size: 25,
    })
  })

  it('keeps date filters inside the scoped filter object', () => {
    const body = buildBody({
      apiKey: 'test-key',
      userId: 'user-123',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    })

    expect(body).toEqual({
      filters: {
        user_id: 'user-123',
        created_at: {
          gte: '2026-01-01',
          lte: '2026-01-31',
        },
      },
      page: 1,
      page_size: 10,
    })
  })

  it('uses the single-memory endpoint for memoryId requests', () => {
    const params = {
      apiKey: 'test-key',
      userId: 'user-123',
      memoryId: 'mem/123',
    }

    expect(buildUrl(params)).toBe('https://api.mem0.ai/v1/memories/mem%2F123/')
    expect(buildMethod(params)).toBe('GET')
    expect(buildBody(params)).toBeUndefined()
  })

  it('extracts memories from paginated v3 responses', async () => {
    const result = await transformResponse(
      new Response(
        JSON.stringify({
          count: 2,
          next: 'https://api.mem0.ai/v3/memories/?page=2&page_size=25',
          previous: null,
          results: [
            { id: 'mem-1', memory: 'First memory.', user_id: 'user-123' },
            { id: 'mem-2', memory: 'Second memory.', user_id: 'user-123' },
          ],
        })
      )
    )

    expect(result.output).toEqual({
      memories: [
        { id: 'mem-1', memory: 'First memory.', user_id: 'user-123' },
        { id: 'mem-2', memory: 'Second memory.', user_id: 'user-123' },
      ],
      ids: ['mem-1', 'mem-2'],
      count: 2,
      next: 'https://api.mem0.ai/v3/memories/?page=2&page_size=25',
      previous: null,
    })
  })

  it('extracts direct single memory responses without rewriting fields', async () => {
    const result = await transformResponse(
      new Response(
        JSON.stringify({
          id: 'mem-1',
          memory: 'Stored memory content.',
          created_at: '2026-01-01T00:00:00Z',
        })
      )
    )

    expect(result.output.memories).toEqual([
      {
        id: 'mem-1',
        memory: 'Stored memory content.',
        created_at: '2026-01-01T00:00:00Z',
      },
    ])
    expect(result.output.ids).toEqual(['mem-1'])
  })
})
