/**
 * Guards the Datadog block's params mapper and declared outputs against the tools they front.
 */
import { describe, expect, it } from 'vitest'
import { DatadogBlock } from '@/blocks/blocks/datadog'

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
