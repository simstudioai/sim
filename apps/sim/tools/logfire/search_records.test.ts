/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { logfireSearchRecordsTool } from '@/tools/logfire/search_records'
import type { LogfireSearchRecordsParams } from '@/tools/logfire/types'

const baseParams: LogfireSearchRecordsParams = { apiKey: 'test-read-token' }

/** Shape `/v2/query` actually returns: rows under `data`, columns under `schema.fields`. */
const WIRE_RESPONSE = {
  schema: {
    fields: [
      { name: 'message', data_type: 'Utf8', nullable: false },
      { name: 'level', data_type: 'Utf8', nullable: true },
    ],
    metadata: {},
  },
  data: [
    { message: 'about to raise an error', level: 'error', trace_id: 'abc', is_exception: true },
    { message: 'ok', level: 'info' },
  ],
}

const sqlFor = (params: LogfireSearchRecordsParams): string => {
  const body = logfireSearchRecordsTool.request.body?.(params) as Record<string, unknown>
  return String(body.sql)
}

describe('logfireSearchRecordsTool request', () => {
  it('targets the regional query endpoint', () => {
    expect(logfireSearchRecordsTool.request.url(baseParams)).toBe(
      'https://logfire-us.pydantic.dev/v2/query'
    )
  })

  it('omits WHERE entirely when no filters are supplied', () => {
    const sql = sqlFor(baseParams)
    expect(sql).not.toContain('WHERE')
    expect(sql).toContain('FROM records')
    expect(sql).toContain('ORDER BY start_timestamp DESC')
    expect(sql).toContain('level_name(level) AS level')
  })

  it('ANDs every supplied filter together', () => {
    const sql = sqlFor({
      ...baseParams,
      query: 'timeout',
      service: 'checkout-api',
      spanName: 'GET /orders',
      minLevel: 'error',
      exceptionsOnly: true,
    })

    expect(sql).toContain("contains(lower(message), 'timeout')")
    expect(sql).toContain("service_name = 'checkout-api'")
    expect(sql).toContain("span_name = 'GET /orders'")
    expect(sql).toContain("level >= 'error'")
    expect(sql).toContain('is_exception')
    expect(sql.match(/ AND /g)).toHaveLength(4)
  })

  it('ignores blank filter values', () => {
    expect(sqlFor({ ...baseParams, query: '   ', service: '' })).not.toContain('WHERE')
  })

  it('neutralizes SQL injection attempts in filter values', () => {
    const sql = sqlFor({ ...baseParams, service: "x' OR 1=1 --" })
    expect(sql).toContain("service_name = 'x'' OR 1=1 --'")
    expect(sql).not.toContain("'x' OR 1=1")
  })

  it('sends the time window alongside the generated SQL', () => {
    const body = logfireSearchRecordsTool.request.body?.({
      ...baseParams,
      minTimestamp: '2026-07-29T00:00:00Z',
      limit: 25,
      environment: 'production',
    }) as Record<string, unknown>

    expect(body).toMatchObject({
      min_timestamp: '2026-07-29T00:00:00Z',
      limit: 25,
      deployment_environment: ['production'],
      include_schema: true,
    })
  })
})

describe('logfireSearchRecordsTool transformResponse', () => {
  it('normalizes rows from the wire payload and reports the executed SQL', async () => {
    const response = new Response(JSON.stringify(WIRE_RESPONSE), { status: 200 })

    const params = { ...baseParams, service: 'checkout-api' }
    const result = await logfireSearchRecordsTool.transformResponse?.(response, params)

    expect(result?.success).toBe(true)
    expect(result?.output.rowCount).toBe(2)
    expect(result?.output.rows[0]).toMatchObject({
      message: 'about to raise an error',
      level: 'error',
      traceId: 'abc',
      isException: true,
    })
    expect(result?.output.sql).toContain("service_name = 'checkout-api'")
  })

  it('returns an empty result set when the query matched nothing', async () => {
    const response = new Response(JSON.stringify({ schema: { fields: [] }, data: [] }), {
      status: 200,
    })
    const result = await logfireSearchRecordsTool.transformResponse?.(response, baseParams)

    expect(result?.output.rows).toEqual([])
    expect(result?.output.rowCount).toBe(0)
  })
})
