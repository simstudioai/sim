/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => ({
  getTrigger: () => ({ subBlocks: [] }),
}))

import { SplunkBlock } from '@/blocks/blocks/splunk'

const toParams = SplunkBlock.tools.config?.params

function mapParams(params: Record<string, unknown>) {
  if (!toParams) throw new Error('SplunkBlock is missing tools.config.params')
  return toParams(params as Parameters<typeof toParams>[0])
}

/**
 * What the tool actually receives. The generic handler merges the mapper's return
 * over the raw serialized subBlock values (`{ ...inputs, ...transformedParams }`), so a
 * key the mapper only assigns conditionally leaves the raw subBlock string in place.
 * Assertions about dropping a value are only meaningful against this merged result.
 */
function mergedInputs(params: Record<string, unknown>) {
  return { ...params, ...mapParams(params) }
}

describe('SplunkBlock tools.config.params', () => {
  describe('search-job toggles', () => {
    it('preserves a typed boolean false from a variable or agent tool call', () => {
      const result = mapParams({
        operation: 'splunk_create_search_job',
        enableLookups: false,
        allowPartialResults: false,
      })

      expect(result.enableLookups).toBe(false)
      expect(result.allowPartialResults).toBe(false)
    })

    it('reads the dropdown string form', () => {
      expect(
        mapParams({
          operation: 'splunk_create_search_job',
          enableLookups: 'false',
          allowPartialResults: 'true',
        })
      ).toMatchObject({ enableLookups: false, allowPartialResults: true })
    })

    it('leaves an untouched toggle undefined so Splunk applies its own default', () => {
      const result = mapParams({
        operation: 'splunk_create_search_job',
        enableLookups: null,
        allowPartialResults: '',
      })

      expect(result.enableLookups).toBeUndefined()
      expect(result.allowPartialResults).toBeUndefined()
    })
  })

  describe('pagination', () => {
    it('omits Max Results when untouched rather than asking for every row', () => {
      const result = mapParams({ operation: 'splunk_list_indexes', count: null, offset: null })

      expect(result).not.toHaveProperty('count')
      expect(result).not.toHaveProperty('offset')
    })

    it('coerces a typed Max Results, including an explicit 0', () => {
      expect(
        mapParams({ operation: 'splunk_list_indexes', count: '50', offset: '10' })
      ).toMatchObject({ count: 50, offset: 10 })
      expect(mapParams({ operation: 'splunk_list_indexes', count: '0' })).toMatchObject({
        count: 0,
      })
    })
  })

  describe('switch-typed toggles', () => {
    it('converts the switch string form so the tool sees a real boolean', () => {
      expect(
        mergedInputs({
          operation: 'splunk_dispatch_saved_search',
          savedSearchName: 'Errors',
          triggerActions: 'true',
          forceDispatch: 'false',
        })
      ).toMatchObject({ triggerActions: true, forceDispatch: false })

      expect(
        mergedInputs({
          operation: 'splunk_get_search_results',
          sid: '1.1',
          addSummaryToMetadata: 'false',
        })
      ).toMatchObject({ addSummaryToMetadata: false })
    })

    it('drops an untouched switch from the merged inputs, not just from the mapper', () => {
      const merged = mergedInputs({
        operation: 'splunk_dispatch_saved_search',
        savedSearchName: 'Errors',
        triggerActions: null,
        forceDispatch: null,
      })

      expect(merged.triggerActions).toBeUndefined()
      expect(merged.forceDispatch).toBeUndefined()
    })
  })

  describe('subBlock to tool param remapping', () => {
    it('maps the saved-search and alert name subBlocks onto the tool name param', () => {
      expect(
        mapParams({ operation: 'splunk_dispatch_saved_search', savedSearchName: 'Errors' })
      ).toMatchObject({ name: 'Errors' })
      expect(
        mapParams({ operation: 'splunk_get_fired_alerts', alertName: 'Errors' })
      ).toMatchObject({ name: 'Errors' })
    })
  })
})

describe('SplunkBlock subBlocks', () => {
  it('has no duplicate subBlock ids', () => {
    const ids = SplunkBlock.subBlocks.map((subBlock) => subBlock.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('exposes every tool in tools.access as an operation option', () => {
    const operation = SplunkBlock.subBlocks.find((subBlock) => subBlock.id === 'operation')
    const optionIds = (operation?.options as { id: string }[]).map((option) => option.id)
    expect([...optionIds].sort()).toEqual([...SplunkBlock.tools.access].sort())
  })
})
