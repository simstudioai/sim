/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { LogfireRegion } from '@/tools/logfire/types'
import {
  buildLogfireQueryBody,
  extractLogfireColumns,
  extractLogfireRows,
  getLogfireBaseUrl,
  logfireHeaders,
  normalizeLogfireRecord,
  parseLogfireResponse,
  sqlContains,
  sqlLiteral,
} from '@/tools/logfire/utils'

const US_BASE = 'https://logfire-us.pydantic.dev'
const EU_BASE = 'https://logfire-eu.pydantic.dev'

/**
 * Build a synthetic read token for a region. Assembled from a template rather
 * than written out as a literal so no credential-shaped string sits in the
 * source; only the `pylf_v{n}_{region}_` prefix is meaningful to the code here.
 */
const readToken = (region: string, version = 1) => `pylf_v${version}_${region}_fixture`

const US_TOKEN = readToken('us')
const EU_TOKEN = readToken('eu')
const EU_TOKEN_V2 = readToken('eu', 2)
const UNKNOWN_REGION_TOKEN = readToken('apac')

describe('getLogfireBaseUrl', () => {
  it('prefers an explicit region over the token prefix', () => {
    expect(getLogfireBaseUrl(EU_TOKEN, 'us')).toBe(US_BASE)
    expect(getLogfireBaseUrl(US_TOKEN, 'eu')).toBe(EU_BASE)
  })

  it('reads the region from the token prefix when set to auto', () => {
    expect(getLogfireBaseUrl(EU_TOKEN, 'auto')).toBe(EU_BASE)
    expect(getLogfireBaseUrl(US_TOKEN, 'auto')).toBe(US_BASE)
    expect(getLogfireBaseUrl(EU_TOKEN_V2)).toBe(EU_BASE)
  })

  it('treats a token with no region prefix as US', () => {
    expect(getLogfireBaseUrl('legacy-token-without-region')).toBe(US_BASE)
    expect(getLogfireBaseUrl('')).toBe(US_BASE)
  })

  it('refuses to guess a host for a region it does not know', () => {
    expect(() => getLogfireBaseUrl(UNKNOWN_REGION_TOKEN)).toThrow(
      "Unrecognized Logfire token region 'apac'"
    )
  })

  it('rejects an explicit region outside the known set rather than building undefined/', () => {
    expect(() => getLogfireBaseUrl(US_TOKEN, 'apac' as unknown as LogfireRegion)).toThrow(
      "Unrecognized Logfire region 'apac'"
    )
  })

  it('lets a self-hosted host override both the region and the token prefix', () => {
    expect(getLogfireBaseUrl(EU_TOKEN, 'us', 'https://logfire.example.com')).toBe(
      'https://logfire.example.com'
    )
  })

  it('assumes HTTPS when the self-hosted host has no scheme', () => {
    expect(getLogfireBaseUrl('token', 'auto', 'logfire.example.com')).toBe(
      'https://logfire.example.com'
    )
  })

  it('keeps an explicit port', () => {
    expect(getLogfireBaseUrl('token', 'auto', 'logfire.example.com:8443')).toBe(
      'https://logfire.example.com:8443'
    )
  })

  it('strips trailing slashes so endpoint paths concatenate cleanly', () => {
    expect(getLogfireBaseUrl('token', 'auto', 'https://logfire.example.com///')).toBe(
      'https://logfire.example.com'
    )
  })

  it('preserves a sub-path for instances served under a prefix', () => {
    expect(getLogfireBaseUrl('token', 'auto', 'https://obs.example.com/logfire/')).toBe(
      'https://obs.example.com/logfire'
    )
  })

  it('ignores a blank host and falls back to region resolution', () => {
    expect(getLogfireBaseUrl(EU_TOKEN, 'auto', '   ')).toBe(EU_BASE)
    expect(getLogfireBaseUrl(EU_TOKEN, 'auto', undefined)).toBe(EU_BASE)
  })

  it('rejects a host carrying a query string or fragment that would swallow the path', () => {
    expect(() =>
      getLogfireBaseUrl('token', 'auto', 'https://logfire.example.com/?last=1h')
    ).toThrow('must not include a query string or fragment')
    expect(() => getLogfireBaseUrl('token', 'auto', 'https://logfire.example.com#panel')).toThrow(
      'must not include a query string or fragment'
    )
  })

  it('rejects userinfo, which would send the read token to another origin', () => {
    expect(() => getLogfireBaseUrl('token', 'auto', 'logfire.example.com@evil.com')).toThrow(
      'must not include credentials'
    )
  })
})

describe('logfireHeaders', () => {
  it('trims the token so a pasted value does not corrupt the bearer credential', () => {
    expect(logfireHeaders(`  ${US_TOKEN}\n`).Authorization).toBe(`Bearer ${US_TOKEN}`)
  })
})

describe('sqlLiteral', () => {
  it('wraps a value in single quotes', () => {
    expect(sqlLiteral('checkout-api')).toBe("'checkout-api'")
  })

  it('escapes embedded single quotes so injected SQL stays a literal', () => {
    expect(sqlLiteral("o'brien")).toBe("'o''brien'")
    expect(sqlLiteral("' OR 1=1 --")).toBe("''' OR 1=1 --'")
  })
})

describe('sqlContains', () => {
  it('builds a case-insensitive literal substring match', () => {
    expect(sqlContains('message', 'Timeout')).toBe("contains(lower(message), 'timeout')")
  })

  it('keeps LIKE wildcards literal and escapes quotes', () => {
    expect(sqlContains('message', "100%'")).toBe("contains(lower(message), '100%''')")
  })
})

describe('buildLogfireQueryBody', () => {
  it('always sends sql, include_schema, and a min_timestamp floor', () => {
    expect(buildLogfireQueryBody({ sql: 'SELECT 1' })).toEqual({
      sql: 'SELECT 1',
      include_schema: true,
      min_timestamp: '2020-01-01T00:00:00Z',
    })
  })

  it('omits optional fields that were not supplied', () => {
    const body = buildLogfireQueryBody({ sql: 'SELECT 1', maxTimestamp: '  ', timezone: '' })
    expect(body).not.toHaveProperty('max_timestamp')
    expect(body).not.toHaveProperty('timezone')
    expect(body).not.toHaveProperty('limit')
    expect(body).not.toHaveProperty('deployment_environment')
  })

  it('passes through a window that already carries an offset', () => {
    expect(
      buildLogfireQueryBody({
        sql: 'SELECT 1',
        minTimestamp: '2026-07-01T00:00:00Z',
        maxTimestamp: '2026-07-02T12:30:00+05:30',
        timezone: 'Europe/Paris',
      })
    ).toMatchObject({
      min_timestamp: '2026-07-01T00:00:00Z',
      max_timestamp: '2026-07-02T12:30:00+05:30',
      timezone: 'Europe/Paris',
    })
  })

  it('assumes UTC for a naive timestamp, which Logfire would otherwise reject', () => {
    expect(
      buildLogfireQueryBody({
        sql: 'SELECT 1',
        minTimestamp: '2026-07-01T00:00:00',
        maxTimestamp: '2026-07-02T00:00:00.123456',
      })
    ).toMatchObject({
      min_timestamp: '2026-07-01T00:00:00Z',
      max_timestamp: '2026-07-02T00:00:00.123456Z',
    })
  })

  it('widens a bare date to midnight UTC', () => {
    expect(buildLogfireQueryBody({ sql: 'SELECT 1', minTimestamp: '2026-07-01' })).toMatchObject({
      min_timestamp: '2026-07-01T00:00:00Z',
    })
  })

  it('clamps limit into the range Logfire accepts', () => {
    expect(buildLogfireQueryBody({ sql: 'SELECT 1', limit: 50 }).limit).toBe(50)
    expect(buildLogfireQueryBody({ sql: 'SELECT 1', limit: 99999 }).limit).toBe(10000)
    expect(buildLogfireQueryBody({ sql: 'SELECT 1', limit: 0 }).limit).toBe(1)
    expect(buildLogfireQueryBody({ sql: 'SELECT 1', limit: 12.7 }).limit).toBe(12)
  })

  it('sends deployment_environment as an array', () => {
    expect(buildLogfireQueryBody({ sql: 'SELECT 1', environment: 'production' })).toMatchObject({
      deployment_environment: ['production'],
    })
  })
})

describe('parseLogfireResponse', () => {
  it('returns the parsed body', async () => {
    const response = new Response(JSON.stringify({ data: [{ a: 1 }] }), { status: 200 })
    await expect(parseLogfireResponse(response)).resolves.toEqual({ data: [{ a: 1 }] })
  })

  it('reports a non-JSON body rather than throwing a parse error', async () => {
    const response = new Response('<html>gateway</html>', { status: 200 })
    await expect(parseLogfireResponse(response)).rejects.toThrow(
      'Logfire returned a response that is not valid JSON'
    )
  })
})

describe('extractLogfireRows', () => {
  it('reads rows from the wire `data` key', () => {
    expect(
      extractLogfireRows({
        schema: { fields: [{ name: 'kind', data_type: 'Utf8', nullable: false }] },
        data: [{ kind: 'log' }, { kind: 'span' }],
      })
    ).toEqual([{ kind: 'log' }, { kind: 'span' }])
  })

  it('returns an empty array when the query matched nothing', () => {
    expect(extractLogfireRows({ schema: { fields: [] }, data: [] })).toEqual([])
    expect(extractLogfireRows({})).toEqual([])
  })
})

describe('extractLogfireColumns', () => {
  it('reads column metadata from schema.fields and renames data_type', () => {
    expect(
      extractLogfireColumns({
        schema: {
          fields: [
            { name: 'kind', data_type: 'Utf8', nullable: false },
            { name: 'tags', data_type: { List: { name: 'item' } }, nullable: true },
          ],
        },
        data: [],
      })
    ).toEqual([
      { name: 'kind', datatype: 'Utf8', nullable: false },
      { name: 'tags', datatype: { List: { name: 'item' } }, nullable: true },
    ])
  })

  it('returns an empty array when no schema was returned', () => {
    expect(extractLogfireColumns({ data: [] })).toEqual([])
  })
})

describe('normalizeLogfireRecord', () => {
  it('maps the records projection into camelCase fields', () => {
    expect(
      normalizeLogfireRecord({
        start_timestamp: '2026-07-29T10:00:00Z',
        end_timestamp: '2026-07-29T10:00:01Z',
        duration: 1.25,
        level: 'error',
        message: 'boom',
        span_name: 'GET /orders',
        kind: 'span',
        service_name: 'checkout-api',
        deployment_environment: 'production',
        trace_id: 'abc',
        span_id: 'def',
        parent_span_id: 'ghi',
        is_exception: true,
        exception_type: 'ValueError',
        exception_message: 'bad input',
      })
    ).toEqual({
      startTimestamp: '2026-07-29T10:00:00Z',
      endTimestamp: '2026-07-29T10:00:01Z',
      duration: 1.25,
      level: 'error',
      message: 'boom',
      spanName: 'GET /orders',
      kind: 'span',
      serviceName: 'checkout-api',
      deploymentEnvironment: 'production',
      traceId: 'abc',
      spanId: 'def',
      parentSpanId: 'ghi',
      isException: true,
      exceptionType: 'ValueError',
      exceptionMessage: 'bad input',
    })
  })

  it('nulls fields that are absent or of an unexpected type', () => {
    const record = normalizeLogfireRecord({ duration: 'slow', message: null })
    expect(record.duration).toBeNull()
    expect(record.message).toBeNull()
    expect(record.endTimestamp).toBeNull()
    expect(record.isException).toBeNull()
  })
})
