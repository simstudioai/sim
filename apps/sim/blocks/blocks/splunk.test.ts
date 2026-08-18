/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => ({
  getTrigger: () => ({ subBlocks: [] }),
}))

import { SplunkBlock, SplunkBlockMeta } from '@/blocks/blocks/splunk'
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

describe('SplunkBlock subBlock placeholders', () => {
  function subBlock(id: string) {
    const found = SplunkBlock.subBlocks.find((block) => block.id === id)
    if (!found) throw new Error(`SplunkBlock is missing the ${id} subBlock`)
    return found
  }

  function subBlocksFor(id: string, operation: string) {
    return SplunkBlock.subBlocks.filter((block) => {
      if (block.id !== id) return false
      const value = block.condition?.value
      return Array.isArray(value) ? value.includes(operation) : value === operation
    })
  }

  /**
   * `nobody` names the shared-application owner, so it is one specific owner
   * rather than a neutral filler — and users copy placeholders. `-` is the
   * documented wildcard for all users, which is what the namespace builder
   * already substitutes.
   */
  it('offers the - wildcard as the namespace owner, not nobody', () => {
    expect(subBlock('owner').placeholder).toBe('-')
  })

  /**
   * The old placeholder claimed a default of 100 for all five operations (the real
   * default is 30 for the four collection endpoints) and advertised `0 returns
   * all` — an unbounded read that Get Search Results now rejects outright. Because
   * this block keeps subBlock ids unique, one field serves every operation, so it
   * must not state a rule that holds for only some of them.
   */
  it('does not advertise a wrong default or an unbounded read on Max Results', () => {
    const shown = subBlocksFor('count', 'splunk_get_search_results')
    expect(shown).toHaveLength(1)

    const placeholder = String(shown[0].placeholder)
    expect(placeholder).not.toContain('100')
    expect(placeholder).not.toMatch(/0 returns all/)
  })

  /** The per-operation detail the placeholder can no longer carry. */
  it('documents the differing defaults and the 0 rule on the count input', () => {
    const description = String(SplunkBlock.inputs.count.description)

    expect(description).toContain('30')
    expect(description).toContain('100')
    expect(description).toMatch(/reject/i)
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

  it('erases an unparseable Max Stored Results on both search operations', () => {
    for (const operation of ['splunk_run_search', 'splunk_create_search_job']) {
      const merged = mergedInputs({
        operation,
        search: 'index=main',
        autoCancel: '5 minutes',
        maxCount: '1,000',
      })

      expect(merged.autoCancel).toBeUndefined()
      expect(merged.maxCount).toBeUndefined()
    }
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

  it('still coerces the numeric forms it is given', () => {
    expect(
      mapParams({ operation: 'splunk_create_search_job', autoCancel: '300', maxCount: 5000 })
    ).toMatchObject({ autoCancel: 300, maxCount: 5000 })
  })
})

describe('SplunkBlock outputs', () => {
  it('declares the paging total and offset the list tools now project', () => {
    expect(SplunkBlock.outputs).toHaveProperty('total')
    expect(SplunkBlock.outputs).toHaveProperty('offset')
  })

  /**
   * The job entry documents this pair as bare numbers, unlike the ISO-string
   * `earliestTime`/`latestTime`, and the block's union output must agree with the
   * tool or the workflow is promised the wrong type.
   */
  it('types the epoch search time bounds as numbers', () => {
    expect(SplunkBlock.outputs.searchEarliestTime).toMatchObject({ type: 'number' })
    expect(SplunkBlock.outputs.searchLatestTime).toMatchObject({ type: 'number' })
  })

  /**
   * `[{type, text}]` holds for the search and job-control operations, but Get
   * Search Job projects the job entry's `messages` object. One shared union
   * output cannot promise the array shape for all of them.
   */
  it('does not promise an array shape that get_search_job does not return', () => {
    const description = String(SplunkBlock.outputs.messages.description)

    expect(description).toMatch(/Get Search Job/)
    expect(description).toMatch(/object/i)
  })
})

describe('SplunkBlockMeta skills', () => {
  it('suggests skills grounded in the operations the block exposes', () => {
    const skills = SplunkBlockMeta.skills

    expect(skills?.length).toBeGreaterThanOrEqual(3)
    for (const skill of skills ?? []) {
      expect(skill.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(skill.description.trim()).not.toBe('')
      expect(skill.content.trim()).not.toBe('')
    }
  })

  it('gives every skill a distinct name', () => {
    const names = (SplunkBlockMeta.skills ?? []).map((skill) => skill.name)
    expect(new Set(names).size).toBe(names.length)
  })

  /**
   * Run Search applies no Sim-side `max_count`, so a skill that tells the model
   * "at most 1000 rows by default" states a bound that does not exist.
   */
  it('does not claim a row cap Run Search no longer applies', () => {
    const skill = SplunkBlockMeta.skills?.find((entry) => entry.name === 'search-splunk-logs')

    expect(skill).toBeDefined()
    expect(skill?.content).not.toMatch(/1000/)
    expect(skill?.content).toMatch(/cannot page/)
  })
})
