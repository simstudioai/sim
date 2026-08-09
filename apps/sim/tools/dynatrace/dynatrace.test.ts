/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { DynatraceBlock } from '@/blocks/blocks/dynatrace'
import { addTagsTool } from '@/tools/dynatrace/add_tags'
import { closeProblemTool } from '@/tools/dynatrace/close_problem'
import { createSettingsObjectTool } from '@/tools/dynatrace/create_settings_object'
import { createSloTool } from '@/tools/dynatrace/create_slo'
import { getAttackTool } from '@/tools/dynatrace/get_attack'
import { getAuditLogsTool } from '@/tools/dynatrace/get_audit_logs'
import { getEntityTool } from '@/tools/dynatrace/get_entity'
import { getMetricTool } from '@/tools/dynatrace/get_metric'
import { getProblemTool } from '@/tools/dynatrace/get_problem'
import { getSecurityProblemTool } from '@/tools/dynatrace/get_security_problem'
import { getSloTool } from '@/tools/dynatrace/get_slo'
import { getSyntheticBatchTool } from '@/tools/dynatrace/get_synthetic_batch'
import { ingestEventTool } from '@/tools/dynatrace/ingest_event'
import { ingestLogsTool } from '@/tools/dynatrace/ingest_logs'
import { ingestMetricsTool } from '@/tools/dynatrace/ingest_metrics'
import { listAttacksTool } from '@/tools/dynatrace/list_attacks'
import { listEntitiesTool } from '@/tools/dynatrace/list_entities'
import { listEntityTypesTool } from '@/tools/dynatrace/list_entity_types'
import { listEventsTool } from '@/tools/dynatrace/list_events'
import { listMetricsTool } from '@/tools/dynatrace/list_metrics'
import { listProblemCommentsTool } from '@/tools/dynatrace/list_problem_comments'
import { listProblemsTool } from '@/tools/dynatrace/list_problems'
import { listRemediationItemsTool } from '@/tools/dynatrace/list_remediation_items'
import { listSecurityProblemsTool } from '@/tools/dynatrace/list_security_problems'
import { listSettingsObjectsTool } from '@/tools/dynatrace/list_settings_objects'
import { listSettingsSchemasTool } from '@/tools/dynatrace/list_settings_schemas'
import { listSlosTool } from '@/tools/dynatrace/list_slos'
import { listSyntheticMonitorsTool } from '@/tools/dynatrace/list_synthetic_monitors'
import { listTagsTool } from '@/tools/dynatrace/list_tags'
import { muteSecurityProblemTool } from '@/tools/dynatrace/mute_security_problem'
import { muteSecurityProblemsTool } from '@/tools/dynatrace/mute_security_problems'
import { queryMetricsTool } from '@/tools/dynatrace/query_metrics'
import { searchLogsTool } from '@/tools/dynatrace/search_logs'
import { updateSettingsObjectTool } from '@/tools/dynatrace/update_settings_object'
import { updateSloTool } from '@/tools/dynatrace/update_slo'
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
    expect(new URL(url(getProblemTool, { ...base, problemId: '  P-123_456V2  ' })).pathname).toBe(
      '/api/v2/problems/P-123_456V2'
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

describe('new-surface request shaping', () => {
  const base = { environmentUrl: ENV, apiToken: TOKEN }

  it('routes synthetic monitors to Environment API v1, not v2', () => {
    expect(url(listSyntheticMonitorsTool, base)).toBe(`${ENV}/api/v1/synthetic/monitors`)
    // ...while executions stay on v2.
    expect(url(getSyntheticBatchTool, { ...base, batchId: 'B-1' })).toBe(
      `${ENV}/api/v2/synthetic/executions/batch/B-1`
    )
  })

  it('strips a trailing /api/v1 as well as /api/v2 from the environment URL', () => {
    expect(url(listSyntheticMonitorsTool, { ...base, environmentUrl: `${ENV}/api/v1` })).toBe(
      `${ENV}/api/v1/synthetic/monitors`
    )
  })

  it('treats the synthetic enabled filter as tri-state, not a boolean', () => {
    const params = (DynatraceBlock.tools.config?.params ?? (() => ({}))) as (
      p: Record<string, unknown>
    ) => Record<string, unknown>
    const call = (monitorEnabled: string | undefined) =>
      params({
        operation: 'dynatrace_list_synthetic_monitors',
        environmentUrl: ENV,
        apiToken: TOKEN,
        monitorEnabled,
      })

    // "Any" must send no filter — `enabled=false` would return only the
    // disabled monitors, which is the opposite of what the user asked for.
    expect(call('').enabled).toBeUndefined()
    expect(call(undefined).enabled).toBeUndefined()
    expect(call('true').enabled).toBe(true)
    expect(call('false').enabled).toBe(false)

    // A value wired from an upstream block arrives as a real boolean, which must
    // not read as "disabled only" the way `true === 'true'` would.
    expect(call(true as unknown as string).enabled).toBe(true)
    expect(call(false as unknown as string).enabled).toBe(false)

    expect(url(listSyntheticMonitorsTool, { environmentUrl: ENV, apiToken: TOKEN })).toBe(
      `${ENV}/api/v1/synthetic/monitors`
    )
    expect(
      url(listSyntheticMonitorsTool, { environmentUrl: ENV, apiToken: TOKEN, enabled: true })
    ).toBe(`${ENV}/api/v1/synthetic/monitors?enabled=true`)
  })

  it('keeps every remaining switch a real boolean, since off means false for each', () => {
    // monitorEnabled was the only tri-state filter. For the rest, Dynatrace's
    // own default is false, so serializing the off position is correct — this
    // pins that they stay switches rather than drifting into the same trap.
    const switches = DynatraceBlock.subBlocks
      .filter((sb) => sb.type === 'switch')
      .map((sb) => sb.id)
    expect(switches).not.toContain('monitorEnabled')
    expect(switches.sort()).toEqual(
      [
        'burnRateVisualizationEnabled',
        'deleteAllWithKey',
        'evaluate',
        'failOnPerformanceIssue',
        'showGlobalSlos',
        'sloEnabled',
        'stopOnProblem',
        'takeScreenshotsOnSuccess',
        'validateOnly',
      ].sort()
    )
  })

  it('repeats the synthetic tag param once per value', () => {
    expect(url(listSyntheticMonitorsTool, { ...base, tag: 'a, b' })).toBe(
      `${ENV}/api/v1/synthetic/monitors?tag=a&tag=b`
    )
  })

  it('accepts bulk security problem IDs as a list, JSON array, or comma string', () => {
    const read = (ids: unknown) =>
      (
        body(muteSecurityProblemsTool, {
          ...base,
          securityProblemIds: ids,
          reason: 'FALSE_POSITIVE',
        }) as Record<string, unknown>
      ).securityProblemIds

    expect(read('S-1, S-2')).toEqual(['S-1', 'S-2'])
    expect(read('["S-1","S-2"]')).toEqual(['S-1', 'S-2'])
    expect(read(['S-1', 'S-2'])).toEqual(['S-1', 'S-2'])
  })

  it('refuses a bulk mute with no IDs rather than sending an empty batch', () => {
    expect(() =>
      body(muteSecurityProblemsTool, { ...base, securityProblemIds: '', reason: 'IGNORE' })
    ).toThrow(/at least one ID/)
  })

  it('wraps a settings object create in the array the endpoint expects', () => {
    const sent = body(createSettingsObjectTool, {
      ...base,
      schemaId: 'builtin:alerting.maintenance-window',
      scope: 'environment',
      value: '{"enabled":true}',
    }) as string
    expect(JSON.parse(sent)).toEqual([
      {
        schemaId: 'builtin:alerting.maintenance-window',
        scope: 'environment',
        value: { enabled: true },
      },
    ])
  })

  it('sends the update token so a concurrent settings change is not overwritten', () => {
    const sent = body(updateSettingsObjectTool, {
      ...base,
      objectId: 'O-1',
      value: { enabled: false },
      updateToken: 'TOKEN-123',
    }) as Record<string, unknown>
    expect(sent.updateToken).toBe('TOKEN-123')
    expect(sent.value).toEqual({ enabled: false })
  })

  it('builds the same SLO body for create and update', () => {
    const fields = {
      ...base,
      name: 'Checkout',
      target: 99.5,
      warning: 99.8,
      timeframe: '-1w',
      evaluationType: 'AGGREGATE',
      fastBurnThreshold: 10,
    }
    const created = body(createSloTool, fields) as Record<string, unknown>
    const updated = body(updateSloTool, { ...fields, sloId: 'SLO-1' }) as Record<string, unknown>
    expect(created).toEqual(updated)
    expect(created.errorBudgetBurnRate).toEqual({ fastBurnThreshold: 10 })
  })

  it('requires a non-empty tag array before writing tags', () => {
    expect(() =>
      body(addTagsTool, { ...base, entitySelector: 'type("HOST")', tags: '[]' })
    ).toThrow(/non-empty array/)
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

  it('rejects an empty log payload instead of sending a no-op that reports success', () => {
    // Dynatrace answers 204 to `[]`, which would otherwise surface as accepted:true.
    expect(() => body(ingestLogsTool, { ...base, logs: [] })).toThrow(/at least one log event/)
    expect(() => body(ingestLogsTool, { ...base, logs: '' })).toThrow(/at least one log event/)
    expect(() => body(ingestLogsTool, { ...base, logs: undefined })).toThrow(
      /at least one log event/
    )
  })

  it('rejects a malformed JSON string rather than silently dropping the payload', () => {
    expect(() => body(ingestLogsTool, { ...base, logs: '{not json' })).toThrow(/valid JSON/)
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

  /**
   * A wrong top-level key does not throw — it yields an empty list and looks like
   * "no results". Each payload below is shaped exactly like the documented schema,
   * so an incorrect key fails loudly here instead of silently in production.
   */
  it('reads the documented top-level key of every list response', async () => {
    const cases: Array<{
      name: string
      tool: { transformResponse?: (r: Response) => Promise<{ output: Record<string, never> }> }
      payload: Record<string, unknown>
      read: (out: Record<string, never>) => unknown
    }> = [
      {
        name: 'GET /slo -> slo',
        tool: listSlosTool,
        payload: { totalCount: 1, slo: [{ id: 'SLO-1', name: 'Checkout', status: 'WARNING' }] },
        read: (o) => o.slos,
      },
      {
        name: 'GET /metrics/query -> result',
        tool: queryMetricsTool,
        payload: {
          resolution: '1h',
          result: [
            {
              metricId: 'builtin:host.cpu.usage',
              data: [{ dimensions: ['HOST-1'], timestamps: [1], values: [42.5] }],
            },
          ],
        },
        read: (o) => o.result,
      },
      {
        name: 'GET /metrics -> metrics',
        tool: listMetricsTool,
        payload: { totalCount: 1, metrics: [{ metricId: 'builtin:host.cpu.usage' }] },
        read: (o) => o.metrics,
      },
      {
        name: 'GET /entities -> entities',
        tool: listEntitiesTool,
        payload: { totalCount: 1, entities: [{ entityId: 'HOST-1', type: 'HOST' }] },
        read: (o) => o.entities,
      },
      {
        name: 'GET /entityTypes -> types',
        tool: listEntityTypesTool,
        payload: { totalCount: 1, types: [{ type: 'HOST', displayName: 'Host' }] },
        read: (o) => o.types,
      },
      {
        name: 'GET /events -> events',
        tool: listEventsTool,
        payload: { totalCount: 1, events: [{ eventId: 'E-1', eventType: 'CUSTOM_DEPLOYMENT' }] },
        read: (o) => o.events,
      },
      {
        name: 'GET /securityProblems -> securityProblems',
        tool: listSecurityProblemsTool,
        payload: {
          totalCount: 1,
          securityProblems: [{ securityProblemId: 'S-1', status: 'OPEN' }],
        },
        read: (o) => o.securityProblems,
      },
      {
        name: 'GET /logs/search -> results',
        tool: searchLogsTool,
        payload: { sliceSize: 1, results: [{ timestamp: 1, status: 'ERROR', content: 'boom' }] },
        read: (o) => o.results,
      },
      {
        name: 'GET /problems/{id}/comments -> comments',
        tool: listProblemCommentsTool,
        payload: { totalCount: 1, comments: [{ id: 'C-1', content: 'looking into it' }] },
        read: (o) => o.comments,
      },
      {
        name: 'GET /auditlogs -> auditLogs',
        tool: getAuditLogsTool,
        payload: { totalCount: 1, auditLogs: [{ logId: 'L-1' }] },
        read: (o) => o.auditLogs,
      },
    ]

    for (const { name, tool, payload, read } of cases) {
      const out = (
        await tool.transformResponse!(new Response(JSON.stringify(payload), { status: 200 }))
      ).output
      expect(read(out), `${name} produced an empty list`).toHaveLength(1)
    }
  })

  it('reads the documented scalar keys of the ingest and single-entity responses', async () => {
    const metrics = (
      await ingestMetricsTool.transformResponse!(
        new Response(JSON.stringify({ linesOk: 7, linesInvalid: 1, error: { code: 400 } }), {
          status: 202,
        })
      )
    ).output
    expect(metrics.linesOk).toBe(7)
    expect(metrics.linesInvalid).toBe(1)
    expect(metrics.ingestError).toEqual({ code: 400 })

    const event = (
      await ingestEventTool.transformResponse!(
        new Response(
          JSON.stringify({
            reportCount: 1,
            eventIngestResults: [{ correlationId: 'c-1', status: 'OK' }],
          }),
          { status: 201 }
        )
      )
    ).output
    expect(event.reportCount).toBe(1)
    expect(event.eventIngestResults).toEqual([{ correlationId: 'c-1', status: 'OK' }])

    // Single-entity endpoints return the object at the document root, not nested.
    const slo = (
      await getSloTool.transformResponse!(
        new Response(JSON.stringify({ id: 'SLO-1', name: 'Checkout', evaluatedPercentage: 99.5 }), {
          status: 200,
        })
      )
    ).output
    expect(slo.slo.id).toBe('SLO-1')
    expect(slo.slo.evaluatedPercentage).toBe(99.5)

    const entity = (
      await getEntityTool.transformResponse!(
        new Response(JSON.stringify({ entityId: 'HOST-1', displayName: 'web-01' }), { status: 200 })
      )
    ).output
    expect(entity.entity.entityId).toBe('HOST-1')

    const closed = (
      await closeProblemTool.transformResponse!(
        new Response(
          JSON.stringify({
            problemId: 'P-1',
            closeTimestamp: 123,
            closing: true,
            comment: { id: 'C-1', content: 'fixed' },
          }),
          { status: 200 }
        )
      )
    ).output
    expect(closed.problemId).toBe('P-1')
    expect(closed.comment?.content).toBe('fixed')
  })

  it('raises on a non-JSON body instead of reporting an empty result', async () => {
    // A gateway HTML page or a truncated payload must not read as "no results".
    const html = new Response('<html><body>502 Bad Gateway</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })
    await expect(listProblemsTool.transformResponse!(html)).rejects.toThrow(/non-JSON body/)
  })

  it('still tolerates the genuinely empty bodies of 201 and 204', async () => {
    const created = await listProblemCommentsTool.transformResponse!(
      new Response(null, { status: 204 })
    )
    expect(created.output.comments).toEqual([])
  })

  it('reads the documented top-level key of the newer list responses', async () => {
    const cases: Array<{
      name: string
      tool: { transformResponse?: (r: Response) => Promise<{ output: Record<string, never> }> }
      payload: Record<string, unknown>
      read: (out: Record<string, never>) => unknown
    }> = [
      {
        name: 'GET /attacks -> attacks',
        tool: listAttacksTool,
        payload: { totalCount: 1, attacks: [{ attackId: 'A-1', state: 'EXPLOITED' }] },
        read: (o) => o.attacks,
      },
      {
        name: 'GET /tags -> tags',
        tool: listTagsTool,
        payload: { totalCount: 1, tags: [{ key: 'env', value: 'prod' }] },
        read: (o) => o.tags,
      },
      {
        name: 'GET /settings/schemas -> items',
        tool: listSettingsSchemasTool,
        payload: { totalCount: 1, items: [{ schemaId: 'builtin:alerting.profile' }] },
        read: (o) => o.schemas,
      },
      {
        name: 'GET /settings/objects -> items',
        tool: listSettingsObjectsTool,
        payload: { totalCount: 1, items: [{ objectId: 'O-1', value: { enabled: true } }] },
        read: (o) => o.items,
      },
      {
        name: 'GET /securityProblems/{id}/remediationItems -> remediationItems',
        tool: listRemediationItemsTool,
        payload: { remediationItems: [{ id: 'R-1', vulnerabilityState: 'VULNERABLE' }] },
        read: (o) => o.remediationItems,
      },
      {
        name: 'GET /api/v1/synthetic/monitors -> monitors',
        tool: listSyntheticMonitorsTool,
        payload: { monitors: [{ entityId: 'SYNTHETIC_TEST-1', name: 'checkout', type: 'HTTP' }] },
        read: (o) => o.monitors,
      },
    ]

    for (const { name, tool, payload, read } of cases) {
      const out = (
        await tool.transformResponse!(new Response(JSON.stringify(payload), { status: 200 }))
      ).output
      expect(read(out), `${name} produced an empty list`).toHaveLength(1)
    }
  })

  it('reads a created SLO id from the Location header, since the body is empty', async () => {
    const created = new Response(null, {
      status: 201,
      headers: { location: 'https://abc.live.dynatrace.com/api/v2/slo/1234-5678' },
    })
    const out = (
      await createSloTool.transformResponse!(created, {
        environmentUrl: ENV,
        apiToken: TOKEN,
        name: 'Checkout',
      } as never)
    ).output
    expect(out.sloId).toBe('1234-5678')
    expect(out.name).toBe('Checkout')
  })

  it('counts only the security problems whose mute state actually changed', async () => {
    const body = JSON.stringify({
      summary: [
        { securityProblemId: 'S-1', muteStateChangeTriggered: true },
        { securityProblemId: 'S-2', muteStateChangeTriggered: false, reason: 'ALREADY_MUTED' },
      ],
    })
    const out = (
      await muteSecurityProblemsTool.transformResponse!(new Response(body, { status: 200 }))
    ).output
    expect(out.summary).toHaveLength(2)
    expect(out.changedCount).toBe(1)
  })

  it('treats a 204 mute as "already in that state" rather than a fresh change', async () => {
    const out = (
      await muteSecurityProblemTool.transformResponse!(new Response(null, { status: 204 }), {
        environmentUrl: ENV,
        apiToken: TOKEN,
        securityProblemId: 'S-1',
        reason: 'FALSE_POSITIVE',
      } as never)
    ).output
    expect(out.alreadyInState).toBe(true)
    expect(out.securityProblemId).toBe('S-1')
  })

  it('surfaces a 200 partial-success log ingestion body', async () => {
    const response = new Response(JSON.stringify({ error: { message: 'some invalid' } }), {
      status: 200,
    })
    const result = await ingestLogsTool.transformResponse!(response)
    expect(result.output.accepted).toBe(false)
    expect(result.output.details).toEqual({ error: { message: 'some invalid' } })
  })

  it('fails a settings write that Dynatrace rejected per-object under a 2xx', async () => {
    const rejected = JSON.stringify([
      { code: 400, error: { code: 400, message: 'value.enabled is required' } },
    ])

    await expect(
      createSettingsObjectTool.transformResponse!(new Response(rejected, { status: 207 }))
    ).rejects.toThrow(/value.enabled is required/)

    await expect(
      updateSettingsObjectTool.transformResponse!(
        new Response(JSON.stringify({ code: 400, error: { message: 'schema mismatch' } }), {
          status: 207,
        })
      )
    ).rejects.toThrow(/schema mismatch/)
  })
})

describe('detail requests ask for the properties they map', () => {
  const base = { environmentUrl: ENV, apiToken: TOKEN }

  it('requests every optional vulnerability property by default', () => {
    // Dynatrace omits description, remediation guidance, and affected entities
    // unless they are named in `fields`, so an unset default would map nulls.
    const requested = new URL(
      url(getSecurityProblemTool, { ...base, securityProblemId: 'S-1' })
    ).searchParams
      .get('fields')
      ?.split(',')

    expect(requested).toEqual(
      expect.arrayContaining([
        '+description',
        '+remediationDescription',
        '+affectedEntities',
        '+vulnerableComponents',
        '+riskAssessment',
      ])
    )

    // An explicit choice still wins.
    expect(
      new URL(
        url(getSecurityProblemTool, {
          ...base,
          securityProblemId: 'S-1',
          fields: '+riskAssessment',
        })
      ).searchParams.get('fields')
    ).toBe('+riskAssessment')
  })

  it('requests every optional attack property by default', () => {
    expect(
      new URL(url(getAttackTool, { ...base, attackId: 'A-1' })).searchParams.get('fields')
    ).toBe(
      '+attackTarget,+request,+entrypoint,+vulnerability,+securityProblem,+attacker,+managementZones'
    )

    expect(
      new URL(
        url(getAttackTool, { ...base, attackId: 'A-1', fields: '+attacker' })
      ).searchParams.get('fields')
    ).toBe('+attacker')
  })

  it('requests the optional problem properties by default', () => {
    expect(
      new URL(url(getProblemTool, { ...base, problemId: 'P-1' })).searchParams.get('fields')
    ).toBe('evidenceDetails,impactAnalysis,recentComments')

    expect(
      new URL(
        url(getProblemTool, { ...base, problemId: 'P-1', fields: 'impactAnalysis' })
      ).searchParams.get('fields')
    ).toBe('impactAnalysis')
  })
})

describe('mute state writes', () => {
  const params = (DynatraceBlock.tools.config?.params ?? (() => ({}))) as (
    p: Record<string, unknown>
  ) => Record<string, unknown>

  const call = (operation: string) =>
    params({
      operation,
      environmentUrl: ENV,
      apiToken: TOKEN,
      securityProblemId: 'S-1',
      securityProblemIds: 'S-1, S-2',
      // The shared dropdown's default. It is a valid mute reason and an invalid
      // unmute one, so forwarding it would make every unmute fail.
      muteReason: 'FALSE_POSITIVE',
    })

  it('sends AFFECTED for an unmute, the only reason the API accepts', () => {
    expect(call('dynatrace_unmute_security_problem').reason).toBe('AFFECTED')
    expect(call('dynatrace_unmute_security_problems').reason).toBe('AFFECTED')
  })

  it('still forwards the chosen reason for a mute', () => {
    expect(call('dynatrace_mute_security_problem').reason).toBe('FALSE_POSITIVE')
    expect(call('dynatrace_mute_security_problems').reason).toBe('FALSE_POSITIVE')
  })

  it('offers only mute reasons in the dropdown, and only to the mute operations', () => {
    const reason = DynatraceBlock.subBlocks.find((sb) => sb.id === 'muteReason')
    expect(reason?.options).not.toContainEqual(expect.objectContaining({ id: 'AFFECTED' }))
    expect(reason?.condition).toEqual({
      field: 'operation',
      value: ['dynatrace_mute_security_problem', 'dynatrace_mute_security_problems'],
    })
  })
})
