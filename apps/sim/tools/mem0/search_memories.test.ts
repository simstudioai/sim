import { describe, expect, it } from 'vitest'
import { mem0SearchMemoriesTool } from '@/tools/mem0/search_memories'

describe('mem0SearchMemoriesTool', () => {
  const buildBody = mem0SearchMemoriesTool.request.body!
  const transformResponse = mem0SearchMemoriesTool.transformResponse!

  it('builds the documented search request body', () => {
    const body = buildBody({
      apiKey: 'test-key',
      userId: ' alice ',
      query: 'where does the user live?',
      limit: 20,
    })

    expect(body).toEqual({
      query: 'where does the user live?',
      filters: {
        user_id: 'alice',
      },
      top_k: 20,
    })
  })

  it('extracts results from v3 response envelopes', async () => {
    const result = await transformResponse(
      new Response(
        JSON.stringify({
          results: [
            {
              id: 'mem-1',
              memory: 'User lives in San Francisco.',
              user_id: 'alice',
              categories: ['location'],
              score: 0.82,
              created_at: '2026-01-15T10:30:00Z',
              updated_at: '2026-01-15T10:30:00Z',
            },
          ],
        })
      )
    )

    expect(result.output).toEqual({
      searchResults: [
        {
          id: 'mem-1',
          memory: 'User lives in San Francisco.',
          user_id: 'alice',
          agent_id: undefined,
          app_id: undefined,
          run_id: undefined,
          hash: undefined,
          metadata: undefined,
          categories: ['location'],
          created_at: '2026-01-15T10:30:00Z',
          updated_at: '2026-01-15T10:30:00Z',
          score: 0.82,
        },
      ],
      ids: ['mem-1'],
    })
  })
})
