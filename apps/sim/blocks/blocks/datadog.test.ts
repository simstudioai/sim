/**
 * Guards the Datadog block's params mapper and declared outputs against the tools they front.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { DatadogBlock } from '@/blocks/blocks/datadog'
import * as datadogTools from '@/tools/datadog'
import type { ToolConfig } from '@/tools/types'

const toolsById = new Map<string, ToolConfig>(
  Object.values(datadogTools)
    .filter(
      (value): value is ToolConfig => typeof value === 'object' && value !== null && 'id' in value
    )
    .map((tool) => [tool.id, tool])
)

const mapParams = DatadogBlock.tools.config?.params

/**
 * The block hands the executor `{ ...inputs, ...transformedParams }`, so a mapper that simply
 * omits a key leaves the raw serialized subblock value in place. Every assertion about leakage
 * has to run against this merged shape rather than the mapper's return value alone.
 */
function mergedParams(inputs: Record<string, unknown>): Record<string, unknown> {
  return { ...inputs, ...(mapParams?.(inputs as never) as Record<string, unknown>) }
}

const baseInputs = { apiKey: 'key', applicationKey: 'app-key', site: 'datadoghq.com' }

describe('datadog list_monitors params', () => {
  /**
   * `monitorTags` is Create Monitor's advanced tag field, but it serializes for every operation.
   * Leaving it in the merge silently filters the monitor list while presenting it as complete.
   */
  it('clears a leftover Create Monitor tag filter after the merge', () => {
    const params = mergedParams({
      ...baseInputs,
      operation: 'datadog_list_monitors',
      monitorTags: 'team:backend',
    })

    expect(params.monitorTags).toBeUndefined()
  })

  it('still forwards the List Monitors filters', () => {
    const params = mergedParams({
      ...baseInputs,
      operation: 'datadog_list_monitors',
      listMonitorName: 'CPU',
      listMonitorTags: 'env:prod',
    })

    expect(params.name).toBe('CPU')
    expect(params.tags).toBe('env:prod')
  })

  it('forwards pagination as numbers', () => {
    const params = mergedParams({
      ...baseInputs,
      operation: 'datadog_list_monitors',
      listMonitorPageSize: '50',
      listMonitorPage: '2',
    })

    expect(params.pageSize).toBe(50)
    expect(params.page).toBe(2)
  })

  /**
   * These are advanced free-text fields, so they can carry a typo or an unresolved
   * reference. A bare `Number()` would put the literal `NaN` in the query string
   * rather than omitting the parameter.
   */
  it('drops a non-numeric pagination value instead of sending NaN', () => {
    const params = mergedParams({
      ...baseInputs,
      operation: 'datadog_list_monitors',
      listMonitorPageSize: 'fifty',
      listMonitorPage: '{{unresolved}}',
    })

    expect(params.pageSize).toBeUndefined()
    expect(params.page).toBeUndefined()
  })

  it('keeps an explicit page 0, which is Datadog’s first page', () => {
    const params = mergedParams({
      ...baseInputs,
      operation: 'datadog_list_monitors',
      listMonitorPage: '0',
    })

    expect(params.page).toBe(0)
  })

  it('exposes pagination subBlocks gated on List Monitors', () => {
    const paginationIds = ['listMonitorPageSize', 'listMonitorPage']
    for (const id of paginationIds) {
      const subBlock = DatadogBlock.subBlocks.find((candidate) => candidate.id === id)
      expect(subBlock, `missing subBlock ${id}`).toBeDefined()
      expect(subBlock?.condition).toEqual({ field: 'operation', value: 'datadog_list_monitors' })
    }
  })

  /**
   * Both controls sit under Advanced with no help text, so Page Size reads as a
   * bound while Datadog ignores it unless a page is also sent.
   */
  it('tells the user that a page size only applies with a page', () => {
    const pageSize = DatadogBlock.subBlocks.find((c) => c.id === 'listMonitorPageSize')
    const page = DatadogBlock.subBlocks.find((c) => c.id === 'listMonitorPage')

    expect(pageSize?.tooltip).toMatch(/page number/i)
    expect(page?.tooltip).toMatch(/every monitor/i)
  })

  it('states the same rule on the inputs the model reads', () => {
    expect(String(DatadogBlock.inputs.listMonitorPageSize.description)).toMatch(/page number/i)
    expect(String(DatadogBlock.inputs.listMonitorPage.description)).toMatch(/every monitor/i)
  })
})

/**
 * A bare `Number()` on a free-text field turns a typo or an unresolved reference
 * into `NaN`, which `JSON.stringify` writes as `null` and a query string carries
 * as the literal "NaN" — Datadog then rejects the call naming nothing the user
 * typed. Every numeric mapping goes through the shared coercion, not just the
 * two List Monitors fields.
 */
describe('datadog numeric coercion', () => {
  it.each([
    ['datadog_mute_monitor', { muteMonitorId: '123', end: 'tomorrow' }, 'end'],
    ['datadog_query_logs', { logLimit: 'lots' }, 'limit'],
    ['datadog_query_timeseries', { from: 'yesterday', to: 'now' }, 'from'],
    ['datadog_list_incidents', { incidentPageSize: '{{unresolved}}' }, 'pageSize'],
    ['datadog_list_slos', { sloLimit: 'many' }, 'limit'],
    ['datadog_list_dashboards', { dashboardCount: 'n/a' }, 'count'],
    ['datadog_search_spans', { spanLimit: 'lots' }, 'limit'],
    ['datadog_list_services', { servicePageSize: 'big' }, 'pageSize'],
    ['datadog_list_security_rules', { rulePageNumber: 'first' }, 'pageNumber'],
    ['datadog_list_synthetics_tests', { syntheticsPageSize: 'all' }, 'pageSize'],
  ])('drops a non-numeric %s input rather than sending NaN', (operation, inputs, key) => {
    const params = mergedParams({ ...baseInputs, operation, ...inputs })

    expect(params[key]).toBeUndefined()
  })

  /**
   * An explicit 0 is a real offset/page/threshold. A `<Block.output>` reference
   * resolves to the number `0`, which the old truthiness guard dropped outright.
   */
  it.each([
    ['datadog_list_downtimes', { downtimeOffset: 0 }, 'offset'],
    ['datadog_list_slos', { sloOffset: 0 }, 'offset'],
    ['datadog_list_dashboards', { dashboardStart: 0 }, 'start'],
  ])('keeps an explicit zero on %s', (operation, inputs, key) => {
    const params = mergedParams({ ...baseInputs, operation, ...inputs })

    expect(params[key]).toBe(0)
  })
})

describe('datadog create_monitor params', () => {
  /** Clearing the leak must not disarm the operation the field actually belongs to. */
  it('still sends monitor tags as the create payload tags', () => {
    const params = mergedParams({
      ...baseInputs,
      operation: 'datadog_create_monitor',
      name: 'High CPU',
      type: 'metric alert',
      monitorQuery: 'avg(last_5m):avg:system.cpu.user{*} > 90',
      monitorTags: 'team:backend',
    })

    expect(params.tags).toBe('team:backend')
  })
})

describe('datadog block outputs', () => {
  const outputs = DatadogBlock.outputs

  it('declares the fields mute and unmute return', () => {
    for (const toolId of ['datadog_mute_monitor', 'datadog_unmute_monitor']) {
      const toolOutputs = Object.keys(toolsById.get(toolId)?.outputs ?? {})
      expect(toolOutputs).toContain('monitorId')
      for (const field of toolOutputs) {
        expect(outputs, `${toolId} emits ${field}`).toHaveProperty(field)
      }
    }
  })

  /** `errors` is the only signal that Datadog rejected part of a submitted metric batch. */
  it('declares the submit_metrics errors field', () => {
    expect(Object.keys(toolsById.get('datadog_submit_metrics')?.outputs ?? {})).toContain('errors')
    expect(outputs).toHaveProperty('errors')
  })

  it('declares no output no tool can produce', () => {
    const emitted = new Set<string>()
    for (const toolId of DatadogBlock.tools.access ?? []) {
      for (const field of Object.keys(toolsById.get(toolId)?.outputs ?? {})) {
        emitted.add(field)
      }
    }

    expect(Object.keys(outputs).filter((field) => !emitted.has(field))).toEqual([])
  })
})
