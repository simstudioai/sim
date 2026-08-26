/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { fetchPointsTool } from '@/tools/qdrant/fetch_points'
import { searchVectorTool } from '@/tools/qdrant/search_vector'
import { upsertPointsTool } from '@/tools/qdrant/upsert_points'

/**
 * Builds a `Response` carrying a Qdrant REST envelope.
 * @see https://api.qdrant.tech/
 */
function qdrantResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('qdrant_search_vector transformResponse', () => {
  it('unwraps result.points into the declared array output', async () => {
    const response = qdrantResponse({
      usage: { cpu: 1, payload_io_read: 0, payload_io_write: 0 },
      time: 0.002,
      status: 'ok',
      result: {
        points: [
          {
            id: 'point-1',
            version: 3,
            score: 0.87,
            payload: { title: 'first' },
          },
        ],
      },
    })

    const result = await searchVectorTool.transformResponse!(response, {} as never)

    expect(result.success).toBe(true)
    expect(Array.isArray(result.output.data)).toBe(true)
    expect(result.output.data).toHaveLength(1)
    expect(result.output.data[0].score).toBe(0.87)
    expect(result.output.data[0].id).toBe('point-1')
    expect(result.output.status).toBe('ok')
  })

  it('returns an empty array when result is null', async () => {
    const response = qdrantResponse({
      time: 0.001,
      status: 'ok',
      result: null,
    })

    const result = await searchVectorTool.transformResponse!(response, {} as never)

    expect(result.output.data).toEqual([])
  })

  it('yields an empty array when result is a bare point array (legacy /points/search shape)', async () => {
    const response = qdrantResponse({
      time: 0.002,
      status: 'ok',
      result: [{ id: 'point-1', version: 3, score: 0.87, payload: { title: 'first' } }],
    })

    const result = await searchVectorTool.transformResponse!(response, {} as never)

    expect(result.output.data).toEqual([])
    expect(result.output.status).toBe('ok')
  })
})

describe('qdrant_search_vector request', () => {
  it('targets the /points/query endpoint the result.points envelope comes from', () => {
    const url = (searchVectorTool.request!.url as (params: never) => string)({
      url: 'https://cluster.qdrant.io/',
      collection: 'my collection',
    } as never)

    expect(url).toBe('https://cluster.qdrant.io/collections/my%20collection/points/query')
  })
})

describe('qdrant_fetch_points transformResponse', () => {
  it('passes result through as the point array', async () => {
    const response = qdrantResponse({
      time: 0.003,
      status: 'ok',
      result: [
        { id: 'point-1', payload: { title: 'first' } },
        { id: 'point-2', payload: { title: 'second' } },
      ],
    })

    const result = await fetchPointsTool.transformResponse!(response, {} as never)

    expect(result.success).toBe(true)
    expect(Array.isArray(result.output.data)).toBe(true)
    expect(result.output.data).toHaveLength(2)
    expect(result.output.data[1].id).toBe('point-2')
    expect(result.output.status).toBe('ok')
  })
})

describe('qdrant_upsert_points transformResponse', () => {
  it('passes result through as the operation object', async () => {
    const response = qdrantResponse({
      time: 0.004,
      status: 'ok',
      result: { operation_id: 42, status: 'completed' },
    })

    const result = await upsertPointsTool.transformResponse!(response, {} as never)

    expect(result.success).toBe(true)
    expect(result.output.data).toEqual({ operation_id: 42, status: 'completed' })
    expect(result.output.status).toBe('ok')
  })
})
