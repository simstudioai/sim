/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/tools/registry')

import { HarmonicBlock, HarmonicBlockMeta } from '@/blocks/blocks/harmonic'
import { BLOCK_META_REGISTRY, BLOCK_REGISTRY } from '@/blocks/registry-maps'
import { tools } from '@/tools/registry'

describe('HarmonicBlock', () => {
  const buildParams = HarmonicBlock.tools.config!.params!
  const selectTool = HarmonicBlock.tools.config!.tool!
  const resolve = (inputs: Record<string, unknown>) => ({ ...inputs, ...buildParams(inputs) })

  const operationSubBlock = HarmonicBlock.subBlocks.find((subBlock) => subBlock.id === 'operation')
  const operationIds =
    operationSubBlock?.options?.map((option) => (option as { id: string }).id) ?? []

  it('maps every dropdown operation onto exactly one registered tool', () => {
    expect(operationIds).toEqual([
      'harmonic_search_people_scout',
      'harmonic_list_people_saved_searches',
      'harmonic_get_people_saved_search_results',
      'harmonic_batch_get_people',
    ])
    expect(operationIds.map((id) => selectTool({ operation: id }))).toEqual(operationIds)
    expect(new Set(operationIds)).toEqual(new Set(HarmonicBlock.tools.access))
  })

  it('keeps block, tool registry, and operation-specific output contracts in lockstep', () => {
    expect(BLOCK_REGISTRY.harmonic).toBe(HarmonicBlock)
    expect(BLOCK_META_REGISTRY.harmonic).toBe(HarmonicBlockMeta)

    for (const operation of operationIds) {
      const tool = tools[operation]
      expect(tool?.id, `missing registry entry ${operation}`).toBe(operation)

      const blockOutputs = Object.entries(HarmonicBlock.outputs)
        .filter(([, output]) => {
          if (!output.condition) return true
          const values = Array.isArray(output.condition.value)
            ? output.condition.value
            : [output.condition.value]
          return values.includes(operation)
        })
        .map(([name]) => name)

      expect(new Set(blockOutputs), `${operation} block outputs`).toEqual(
        new Set(Object.keys(tool.outputs ?? {}))
      )
    }
  })

  it('defaults to Scout search and rejects unregistered operations', () => {
    expect(operationSubBlock?.value?.({})).toBe('harmonic_search_people_scout')
    expect(() => selectTool({ operation: 'harmonic_delete_people_list' })).toThrow(
      /Invalid Harmonic operation/
    )
  })

  it('gives every subblock a unique id', () => {
    const ids = HarmonicBlock.subBlocks.map((subBlock) => subBlock.id)
    expect(ids).toHaveLength(new Set(ids).size)
  })

  it('does not expose legacy people-list operations, fields, or outputs', () => {
    expect(HarmonicBlock.tools.access.some((id) => id.includes('people_list'))).toBe(false)

    const subBlockIds = HarmonicBlock.subBlocks.map((subBlock) => subBlock.id)
    expect(subBlockIds).not.toEqual(
      expect.arrayContaining(['peopleListId', 'listName', 'sharedWithTeam', 'entries'])
    )

    expect(Object.keys(HarmonicBlock.outputs)).not.toEqual(
      expect.arrayContaining(['peopleLists', 'entries', 'listUrn', 'importUrn'])
    )
  })

  it('keeps the API key password-protected and user-only', () => {
    const apiKey = HarmonicBlock.subBlocks.find((subBlock) => subBlock.id === 'apiKey')
    expect(apiKey).toMatchObject({ password: true, required: true, paramVisibility: 'user-only' })
  })

  it('never hides a required field behind advanced mode', () => {
    const advancedRequired = HarmonicBlock.subBlocks
      .filter((subBlock) => subBlock.mode === 'advanced' && subBlock.required)
      .map((subBlock) => subBlock.id)

    expect(advancedRequired).toEqual([])
  })

  it('forwards only the Scout query and API key for natural-language search', () => {
    const params = resolve({
      operation: 'harmonic_search_people_scout',
      apiKey: 'team-key',
      query: 'Find FDEs in enterprise software',
      savedSearchId: 'stale-search',
      personIds: '[22]',
      personUrns: '["urn:harmonic:person:22"]',
      size: '50',
      cursor: 'stale-cursor',
    })

    expect(params).toMatchObject({ apiKey: 'team-key', query: 'Find FDEs in enterprise software' })
    expect(params.operation).toBeUndefined()
    expect(params.savedSearchId).toBeUndefined()
    expect(params.personIds).toBeUndefined()
    expect(params.personUrns).toBeUndefined()
    expect(params.size).toBeUndefined()
    expect(params.cursor).toBeUndefined()
  })

  it('coerces pagination only for paged reads', () => {
    const savedSearch = resolve({
      operation: 'harmonic_get_people_saved_search_results',
      apiKey: 'team-key',
      savedSearchId: 'urn:harmonic:saved_search:123',
      size: '75',
      cursor: 'opaque-token',
    })
    expect(savedSearch.savedSearchId).toBe('urn:harmonic:saved_search:123')
    expect(savedSearch.size).toBe(75)
    expect(savedSearch.cursor).toBe('opaque-token')

    const list = resolve({
      operation: 'harmonic_list_people_saved_searches',
      apiKey: 'team-key',
      size: '75',
      cursor: 'opaque-token',
    })
    expect(list.size).toBeUndefined()
    expect(list.cursor).toBeUndefined()
  })

  it('parses batch identifiers from JSON strings and preserves resolved arrays', () => {
    const parsed = resolve({
      operation: 'harmonic_batch_get_people',
      apiKey: 'team-key',
      personIds: '[22,1690]',
      personUrns: '["urn:harmonic:person:44"]',
    })
    expect(parsed.personIds).toEqual([22, 1690])
    expect(parsed.personUrns).toEqual(['urn:harmonic:person:44'])

    const direct = resolve({
      operation: 'harmonic_batch_get_people',
      apiKey: 'team-key',
      personIds: [22],
      personUrns: ['urn:harmonic:person:44'],
    })
    expect(direct.personIds).toEqual([22])
    expect(direct.personUrns).toEqual(['urn:harmonic:person:44'])
  })

  it('surfaces malformed JSON instead of forwarding an ambiguous value', () => {
    expect(() =>
      resolve({
        operation: 'harmonic_batch_get_people',
        apiKey: 'team-key',
        personUrns: '[not-json]',
      })
    ).toThrow(SyntaxError)
  })

  it('declares stable contact outputs for every contact-producing operation', () => {
    const contactCondition = HarmonicBlock.outputs.contacts.condition as {
      value: string[]
    }
    expect(new Set(contactCondition.value)).toEqual(
      new Set([
        'harmonic_search_people_scout',
        'harmonic_get_people_saved_search_results',
        'harmonic_batch_get_people',
      ])
    )
    expect(HarmonicBlock.outputs.contacts.description).toContain('personUrn')
    expect(HarmonicBlock.outputs.contacts.description).toContain('linkedinUrl')
  })

  it('ships research-grounded metadata with concrete templates and skills', () => {
    expect(HarmonicBlockMeta.url).toBe('https://harmonic.ai')
    expect(HarmonicBlockMeta.templates.length).toBeGreaterThanOrEqual(7)
    expect(HarmonicBlockMeta.skills.length).toBeGreaterThanOrEqual(5)
    expect(new Set(HarmonicBlockMeta.skills.map((skill) => skill.name)).size).toBe(
      HarmonicBlockMeta.skills.length
    )
  })
})
