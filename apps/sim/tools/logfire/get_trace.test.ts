/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { logfireGetTraceTool } from '@/tools/logfire/get_trace'

/**
 * Build a synthetic read token for a region. Assembled from a template rather
 * than written out as a literal so no credential-shaped string sits in the
 * source; only the `pylf_v{n}_{region}_` prefix is meaningful to the code here.
 */
const readToken = (region: string) => `pylf_v1_${region}_fixture`

const baseParams = {
  apiKey: readToken('eu'),
  traceId: '0123456789abcdef0123456789abcdef',
}

describe('logfireGetTraceTool request', () => {
  it('routes EU tokens to the EU host', () => {
    expect(logfireGetTraceTool.request.url(baseParams)).toBe(
      'https://logfire-eu.pydantic.dev/v2/query'
    )
  })

  it('filters on the trace id and orders spans chronologically', () => {
    const body = logfireGetTraceTool.request.body?.({
      ...baseParams,
      traceId: '  0123456789abcdef0123456789abcdef  ',
    }) as Record<string, unknown>

    expect(String(body.sql)).toContain("trace_id = '0123456789abcdef0123456789abcdef'")
    expect(String(body.sql)).toContain('ORDER BY start_timestamp ASC')
  })

  it('escapes a trace id so it cannot break out of the literal', () => {
    const body = logfireGetTraceTool.request.body?.({
      ...baseParams,
      traceId: "abc' OR 1=1 --",
    }) as Record<string, unknown>

    expect(String(body.sql)).toContain("trace_id = 'abc'' OR 1=1 --'")
    expect(String(body.sql)).not.toContain("'abc' OR 1=1")
  })
})

describe('logfireGetTraceTool transformResponse', () => {
  it('normalizes every span in the trace from the wire payload', async () => {
    const response = new Response(
      JSON.stringify({
        schema: {
          fields: [{ name: 'span_id', data_type: 'Utf8', nullable: false }],
          metadata: {},
        },
        data: [
          { span_id: 'root', parent_span_id: null, span_name: 'GET /orders', duration: 1.5 },
          { span_id: 'child', parent_span_id: 'root', span_name: 'db.query', duration: 0.4 },
        ],
      }),
      { status: 200 }
    )

    const result = await logfireGetTraceTool.transformResponse?.(response, baseParams)

    expect(result?.success).toBe(true)
    expect(result?.output.rowCount).toBe(2)
    expect(result?.output.rows[0]).toMatchObject({ spanId: 'root', parentSpanId: null })
    expect(result?.output.rows[1]).toMatchObject({ spanId: 'child', parentSpanId: 'root' })
    expect(result?.output.sql).toContain('trace_id =')
  })

  it('returns an empty result set for an unknown trace id', async () => {
    const response = new Response(JSON.stringify({ schema: { fields: [] }, data: [] }), {
      status: 200,
    })
    const result = await logfireGetTraceTool.transformResponse?.(response, baseParams)

    expect(result?.output.rows).toEqual([])
    expect(result?.output.rowCount).toBe(0)
  })
})
