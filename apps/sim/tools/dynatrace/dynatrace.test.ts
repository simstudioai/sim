/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getAuditLogsTool } from '@/tools/dynatrace/get_audit_logs'
import { getEntityTool } from '@/tools/dynatrace/get_entity'
import { getMetricTool } from '@/tools/dynatrace/get_metric'
import { getProblemTool } from '@/tools/dynatrace/get_problem'
import { ingestEventTool } from '@/tools/dynatrace/ingest_event'
import { ingestLogsTool } from '@/tools/dynatrace/ingest_logs'
import { listProblemsTool } from '@/tools/dynatrace/list_problems'
import { buildDynatraceUrl, dynatraceHeaders } from '@/tools/dynatrace/utils'
import { ErrorExtractorId, extractErrorMessageWithId } from '@/tools/error-extractors'

const ENV = 'https://abc12345.live.dynatrace.com'
const TOKEN = 'dt0c01.TOKEN'

function url(tool: { request: { url: string | ((p: never) => string) } }, params: object) {
  const build = tool.request.url
  return typeof build === 'function' ? build(params as never) : build
}

function body(tool: { request: { body?: (p: never) => unknown } }, params: object) {
  return tool.request.body?.(params as never)
}

describe('buildDynatraceUrl', () => {
  it('appends the v2 API path to a SaaS environment URL', () => {
    expect(buildDynatraceUrl(ENV, '/problems')).toBe(`${ENV}/api/v2/problems`)
  })

  it('tolerates a trailing slash and a trailing /api/v2 segment', () => {
    expect(buildDynatraceUrl(`${ENV}/`, '/problems')).toBe(`${ENV}/api/v2/problems`)
    expect(buildDynatraceUrl(`${ENV}/api/v2`, '/problems')).toBe(`${ENV}/api/v2/problems`)
    expect(buildDynatraceUrl(`  ${ENV}/api/v2/  `, '/problems')).toBe(`${ENV}/api/v2/problems`)
  })

  it('keeps the environment path of a Managed / ActiveGate URL', () => {
    expect(buildDynatraceUrl('https://ag.example.com:9999/e/abc12345', '/problems')).toBe(
      'https://ag.example.com:9999/e/abc12345/api/v2/problems'
    )
  })

  it('omits unset and empty query params but keeps false', () => {
    expect(
      buildDynatraceUrl(ENV, '/slo', {
        sloSelector: undefined,
        sort: '',
        from: null,
        evaluate: false,
        pageSize: 10,
      })
    ).toBe(`${ENV}/api/v2/slo?evaluate=false&pageSize=10`)
  })
})

describe('auth header', () => {
  it('uses the Api-Token scheme and trims the token', () => {
    expect(dynatraceHeaders(`  ${TOKEN}  `).Authorization).toBe(`Api-Token ${TOKEN}`)
  })
})

describe('path identifiers', () => {
  const base = { environmentUrl: ENV, apiToken: TOKEN }

  it('trims whitespace pasted around an identifier', () => {
    expect(url(getProblemTool, { ...base, problemId: '  P-123_456V2  ' })).toBe(
      `${ENV}/api/v2/problems/P-123_456V2`
    )
    expect(url(getEntityTool, { ...base, entityId: ' HOST-06F288EE2A930951\n' })).toBe(
      `${ENV}/api/v2/entities/HOST-06F288EE2A930951`
    )
  })

  it('leaves the colon separators of a metric key unencoded', () => {
    expect(url(getMetricTool, { ...base, metricKey: ' builtin:host.cpu.usage:avg ' })).toBe(
      `${ENV}/api/v2/metrics/builtin:host.cpu.usage:avg`
    )
  })

  it('drops every other filter once a page cursor is supplied', () => {
    expect(
      url(listProblemsTool, { ...base, nextPageKey: 'CURSOR', from: 'now-7d', pageSize: 500 })
    ).toBe(`${ENV}/api/v2/problems?nextPageKey=CURSOR`)
  })
})

describe('json request params', () => {
  const base = { environmentUrl: ENV, apiToken: TOKEN }

  it('sends a JSON-string log payload as JSON, not as a quoted string', () => {
    const sent = body(ingestLogsTool, {
      ...base,
      logs: '[{"content":"Deploy finished","severity":"info"}]',
    })
    expect(sent).toBe('[{"content":"Deploy finished","severity":"info"}]')
    expect(JSON.parse(sent as string)).toEqual([{ content: 'Deploy finished', severity: 'info' }])
  })

  it('sends an already-parsed log payload unchanged', () => {
    const sent = body(ingestLogsTool, { ...base, logs: [{ content: 'hi' }] })
    expect(JSON.parse(sent as string)).toEqual([{ content: 'hi' }])
  })

  it('parses a JSON-string properties object on event ingest', () => {
    const sent = body(ingestEventTool, {
      ...base,
      eventType: 'CUSTOM_DEPLOYMENT',
      title: 'Deploy 4.12.2',
      properties: '{"version":"4.12.2"}',
    }) as Record<string, unknown>
    expect(sent.properties).toEqual({ version: '4.12.2' })
  })

  it('maps the event timeout onto Dynatrace’s timeout field', () => {
    const sent = body(ingestEventTool, {
      ...base,
      eventType: 'CUSTOM_INFO',
      title: 'x',
      eventTimeout: 30,
    }) as Record<string, unknown>
    expect(sent.timeout).toBe(30)
    expect(sent.eventTimeout).toBeUndefined()
  })

  it('omits optional event fields that were not provided', () => {
    const sent = body(ingestEventTool, {
      ...base,
      eventType: 'CUSTOM_INFO',
      title: 'x',
    }) as Record<string, unknown>
    expect(Object.keys(sent).sort()).toEqual(['eventType', 'title'])
  })
})

describe('error extraction', () => {
  const extract = (data: unknown) =>
    extractErrorMessageWithId({ status: 400, data } as never, ErrorExtractorId.DYNATRACE_ERRORS)

  it('names the offending parameter from constraintViolations', () => {
    expect(
      extract({
        error: {
          code: 400,
          message: 'Constraints violated.',
          constraintViolations: [
            { path: 'metricSelector', message: "Unknown metric key 'builtin:bogus'." },
          ],
        },
      })
    ).toBe("Constraints violated. (metricSelector: Unknown metric key 'builtin:bogus'.)")
  })

  it('joins several violations', () => {
    expect(
      extract({
        error: {
          message: 'Constraints violated.',
          constraintViolations: [
            { path: 'from', message: 'Invalid timeframe.' },
            { path: 'pageSize', message: 'Must be at most 500.' },
          ],
        },
      })
    ).toBe('Constraints violated. (from: Invalid timeframe.; pageSize: Must be at most 500.)')
  })

  it('falls back to the bare message when there are no violations', () => {
    expect(extract({ error: { code: 404, message: 'Problem not found.' } })).toBe(
      'Problem not found.'
    )
  })

  it('every Dynatrace tool pins the extractor so selection is deterministic', () => {
    for (const tool of [
      listProblemsTool,
      getProblemTool,
      getEntityTool,
      getMetricTool,
      getAuditLogsTool,
      ingestEventTool,
      ingestLogsTool,
    ]) {
      expect(tool.errorExtractor).toBe(ErrorExtractorId.DYNATRACE_ERRORS)
    }
  })
})

describe('response mapping', () => {
  it('flattens nested EntityStub ids and normalizes absent optional blocks', async () => {
    const response = new Response(
      JSON.stringify({
        totalCount: 1,
        pageSize: 50,
        nextPageKey: null,
        problems: [
          {
            problemId: 'P-1',
            title: 'CPU saturation',
            status: 'OPEN',
            endTime: -1,
            rootCauseEntity: { entityId: { id: 'HOST-1', type: 'HOST' }, name: 'web-01' },
            affectedEntities: [{ entityId: { id: 'SERVICE-1', type: 'SERVICE' }, name: 'api' }],
          },
        ],
      }),
      { status: 200 }
    )

    const result = await listProblemsTool.transformResponse!(response)
    const problem = result.output.problems[0]

    expect(problem.rootCauseEntity).toEqual({ id: 'HOST-1', type: 'HOST', name: 'web-01' })
    expect(problem.affectedEntities).toEqual([{ id: 'SERVICE-1', type: 'SERVICE', name: 'api' }])
    expect(problem.endTime).toBe(-1)
    expect(problem.impactedEntities).toEqual([])
    expect(problem.evidenceDetails).toBeNull()
    expect(result.output.nextPageKey).toBeNull()
    expect(result.output.warnings).toEqual([])
  })

  it('lifts the dotted dt.settings keys of an audit entry into camelCase', async () => {
    const response = new Response(
      JSON.stringify({
        auditLogs: [
          {
            logId: 'L-1',
            user: 'someone@example.com',
            success: true,
            'dt.settings.schema_id': 'builtin:alerting.profile',
            'dt.settings.object_id': 'OBJ-1',
          },
        ],
      }),
      { status: 200 }
    )

    const result = await getAuditLogsTool.transformResponse!(response)
    expect(result.output.auditLogs[0].settingsSchemaId).toBe('builtin:alerting.profile')
    expect(result.output.auditLogs[0].settingsObjectId).toBe('OBJ-1')
    expect(result.output.auditLogs[0].message).toBeNull()
  })

  it('reads a 204 log ingestion as fully accepted despite the empty body', async () => {
    const result = await ingestLogsTool.transformResponse!(new Response(null, { status: 204 }))
    expect(result.output).toEqual({ accepted: true, statusCode: 204, details: null })
  })

  it('surfaces a 200 partial-success log ingestion body', async () => {
    const response = new Response(JSON.stringify({ error: { message: 'some invalid' } }), {
      status: 200,
    })
    const result = await ingestLogsTool.transformResponse!(response)
    expect(result.output.accepted).toBe(false)
    expect(result.output.details).toEqual({ error: { message: 'some invalid' } })
  })
})
