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
