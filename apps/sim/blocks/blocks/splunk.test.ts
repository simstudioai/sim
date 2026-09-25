import { describe, expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => ({
  getTrigger: () => ({ subBlocks: [] }),
}))

import { SplunkBlock } from '@/blocks/blocks/splunk'
import { buildSplunkFormBody, buildSplunkUrl } from '@/tools/splunk/utils'

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
      const merged = mergedInputs({ operation: 'splunk_list_indexes', count: null, offset: null })

      expect(merged.count ?? undefined).toBeUndefined()
      expect(merged.offset ?? undefined).toBeUndefined()
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
  })
})

describe('SplunkBlock numeric coercion', () => {
  /**
   * A bare `Number()` sent `NaN` for an unparseable value, which serializes as the
   * literal `NaN` and makes Splunk reject the request with an error that names the
   * field but not the cause. Omitting it lets Splunk apply its own default.
   *
   * "Omitting" has to mean omitted from the *merged* inputs the tool receives.
   * Skipping the assignment only removes it from the mapper's return, which the
   * executor then merges over the raw subBlock string — so the typo reaches Splunk
   * anyway. Every assertion here therefore reads `mergedInputs`, not `mapParams`.
   */
  it.each(['abc', 'twenty', '12px', '1,000', '50 rows', '<start.count>'])(
    'erases an unparseable Max Results (%s) from the merged inputs',
    (count) => {
      const merged = mergedInputs({ operation: 'splunk_list_indexes', count })

      expect(merged.count).toBeUndefined()
    }
  )

  it('erases an unparseable value on every numeric field it maps', () => {
    const merged = mergedInputs({
      operation: 'splunk_dispatch_saved_search',
      savedSearchName: 'Errors',
      dispatchMaxCount: '1,000',
      dispatchMaxTime: 'abc',
      dispatchTtl: '30 days',
      offset: 'abc',
    })

    expect(merged.dispatchMaxCount).toBeUndefined()
    expect(merged.dispatchMaxTime).toBeUndefined()
    expect(merged.dispatchTtl).toBeUndefined()
    expect(merged.offset).toBeUndefined()
  })

  /**
   * The erased value must actually disappear from the wire, not serialize as the
   * string `'undefined'`.
   */
  it('keeps an erased numeric field out of the request the tool builds', () => {
    const merged = mergedInputs({ operation: 'splunk_list_indexes', count: '1,000', offset: '10' })

    expect(
      buildSplunkUrl({ baseUrl: 'https://splunk.example.com:8089' }, '/data/indexes', {
        count: merged.count as number | undefined,
        offset: merged.offset as number | undefined,
      })
    ).toBe('https://splunk.example.com:8089/services/data/indexes?offset=10&output_mode=json')

    expect(buildSplunkFormBody({ max_count: merged.count as number | undefined })).toBe('')
  })
})
