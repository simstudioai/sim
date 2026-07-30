/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { logfireQueryTool } from '@/tools/logfire/query'
import type { LogfireQueryParams } from '@/tools/logfire/types'

const baseParams: LogfireQueryParams = {
  apiKey: 'test-read-token',
  sql: 'SELECT message FROM records',
}

describe('logfireQueryTool request', () => {
  it('targets the regional query endpoint', () => {
    expect(logfireQueryTool.request.url(baseParams)).toBe(
      'https://logfire-us.pydantic.dev/v2/query'
    )
  })

  it('sends a self-hosted instance to the configured host', () => {
    expect(logfireQueryTool.request.url({ ...baseParams, host: 'logfire.example.com' })).toBe(
      'https://logfire.example.com/v2/query'
    )
  })

  it('passes the caller SQL through untouched alongside the window', () => {
    const body = logfireQueryTool.request.body?.({
      ...baseParams,
      minTimestamp: '2026-07-29T00:00:00Z',
      limit: 25,
      timezone: 'Europe/Paris',
      environment: 'production',
    }) as Record<string, unknown>

    expect(body).toMatchObject({
      sql: 'SELECT message FROM records',
      min_timestamp: '2026-07-29T00:00:00Z',
      limit: 25,
      timezone: 'Europe/Paris',
      deployment_environment: ['production'],
      include_schema: true,
    })
  })
})

describe('logfireQueryTool transformResponse', () => {
  it('returns raw rows and the column metadata from the wire payload', async () => {
    const response = new Response(
      JSON.stringify({
        schema: {
          fields: [
            { name: 'service_name', data_type: 'Utf8', nullable: false },
            { name: 'calls', data_type: 'Int64', nullable: true },
          ],
          metadata: {},
        },
        data: [
          { service_name: 'checkout-api', calls: 12 },
          { service_name: 'billing', calls: 3 },
        ],
      }),
      { status: 200 }
    )

    const result = await logfireQueryTool.transformResponse?.(response, baseParams)

    expect(result?.success).toBe(true)
    expect(result?.output.rowCount).toBe(2)
    expect(result?.output.rows).toEqual([
      { service_name: 'checkout-api', calls: 12 },
      { service_name: 'billing', calls: 3 },
    ])
    expect(result?.output.columns).toEqual([
      { name: 'service_name', datatype: 'Utf8', nullable: false },
      { name: 'calls', datatype: 'Int64', nullable: true },
    ])
  })

  it('returns an empty result set when the query matched nothing', async () => {
    const response = new Response(JSON.stringify({ schema: { fields: [] }, data: [] }), {
      status: 200,
    })
    const result = await logfireQueryTool.transformResponse?.(response, baseParams)

    expect(result?.output.rows).toEqual([])
    expect(result?.output.columns).toEqual([])
    expect(result?.output.rowCount).toBe(0)
  })
})
