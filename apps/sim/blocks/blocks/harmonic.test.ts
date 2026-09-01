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
      'harmonic_enrich_person',
      'harmonic_get_person',
      'harmonic_batch_get_people',
      'harmonic_get_company_employees',
      'harmonic_list_people_saved_searches',
      'harmonic_get_people_saved_search_results',
      'harmonic_get_people_saved_search_net_new_results',
      'harmonic_clear_people_saved_search_net_new_results',
      'harmonic_submit_email_enrichment_job',
      'harmonic_get_email_enrichment_job',
      'harmonic_get_email_enrichment_usage',
      'harmonic_get_enrichment_status',
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
        .map(([name, output]) => [name, output.type])

      const toolOutputs = Object.entries(tool.outputs ?? {}).map(([name, output]) => [
        name,
        output.type === 'object' ? 'json' : output.type,
      ])

      expect(new Map(blockOutputs), `${operation} block outputs`).toEqual(new Map(toolOutputs))
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

  it('uses one reusable service-account credential with a canonical manual fallback', () => {
    const credential = HarmonicBlock.subBlocks.find((subBlock) => subBlock.id === 'credential')
    const manualCredential = HarmonicBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'manualCredential'
    )

    expect(credential).toMatchObject({
      type: 'oauth-input',
      serviceId: 'harmonic',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
    })
    expect(manualCredential).toMatchObject({
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      required: true,
    })
    expect(HarmonicBlock.subBlocks.some((subBlock) => subBlock.id === 'apiKey')).toBe(false)
  })

  it('pairs saved-search discovery with a canonical manual ID or URN fallback', () => {
    const selector = HarmonicBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'savedSearchSelector'
    )
    const manual = HarmonicBlock.subBlocks.find((subBlock) => subBlock.id === 'savedSearchIdManual')

    expect(selector).toMatchObject({
      type: 'project-selector',
      serviceId: 'harmonic',
      selectorKey: 'harmonic.savedSearches',
      canonicalParamId: 'savedSearchId',
      dependsOn: ['credential'],
      mode: 'basic',
    })
    expect(manual).toMatchObject({
      type: 'short-input',
      canonicalParamId: 'savedSearchId',
      mode: 'advanced',
    })
  })

  it('declares the complete canonical input contract with precise types', () => {
    expect(HarmonicBlock.inputs).toEqual({
      operation: { type: 'string', description: 'Harmonic operation to perform' },
      oauthCredential: {
        type: 'string',
        description: 'Reusable Harmonic team API-key credential',
      },
      query: { type: 'string', description: 'Natural-language Harmonic Scout people query' },
      linkedinUrl: { type: 'string', description: 'LinkedIn profile URL to enrich' },
      email: { type: 'string', description: 'Email address used as an enrichment fallback' },
      personId: { type: 'string', description: 'Harmonic person ID or full person URN' },
      companyContextUrns: {
        type: 'array',
        description: 'Company URNs scoping the returned experience context',
      },
      companyId: { type: 'string', description: 'Harmonic company ID or full company URN' },
      employeeGroupType: { type: 'string', description: 'Employee role group filter' },
      employeeStatus: { type: 'string', description: 'Employment status filter' },
      userConnectionStatus: { type: 'string', description: 'Team or user connection filter' },
      savedSearchId: { type: 'string', description: 'People saved-search ID or full URN' },
      newResultsSince: {
        type: 'string',
        description: 'UTC cutoff for net-new saved-search matches',
      },
      personIds: { type: 'array', description: 'Numeric Harmonic person IDs to retrieve' },
      personUrns: {
        type: 'array',
        description: 'Harmonic person URNs to retrieve or acknowledge',
      },
      personLinkedinUrls: {
        type: 'array',
        description: 'LinkedIn profile URLs to submit for email enrichment',
      },
      clearScope: {
        type: 'string',
        description: 'Whether to clear only the listed person URNs or every net-new result',
      },
      jobId: { type: 'string', description: 'Harmonic email enrichment job ID' },
      enrichmentUrns: { type: 'array', description: 'Harmonic enrichment URNs to check' },
      size: { type: 'number', description: 'Page size, clamped to 1-100' },
      cursor: { type: 'string', description: 'Opaque pagination cursor' },
    })
  })

  it('uses advanced required fields only as canonical fallbacks for required basic fields', () => {
    const advancedRequired = HarmonicBlock.subBlocks.filter(
      (subBlock) => subBlock.mode === 'advanced' && subBlock.required
    )

    expect(advancedRequired.map((subBlock) => subBlock.id)).toEqual([
      'manualCredential',
      'savedSearchIdManual',
    ])
    for (const advanced of advancedRequired) {
      expect(advanced.canonicalParamId).toBeTruthy()
      expect(
        HarmonicBlock.subBlocks.some(
          (subBlock) =>
            subBlock.mode === 'basic' &&
            subBlock.required &&
            subBlock.canonicalParamId === advanced.canonicalParamId
        )
      ).toBe(true)
    }
  })

  it('forwards only the Scout query and reusable credential for natural-language search', () => {
    const params = resolve({
      operation: 'harmonic_search_people_scout',
      oauthCredential: 'credential-id',
      apiKey: 'retired-inline-key',
      query: 'Find FDEs in enterprise software',
      savedSearchId: 'stale-search',
      savedSearchSelector: 'stale-selector-value',
      savedSearchIdManual: 'stale-manual-value',
      personIds: '[22]',
      personUrns: '["urn:harmonic:person:22"]',
      size: '50',
      cursor: 'stale-cursor',
    })

    expect(params).toMatchObject({
      oauthCredential: 'credential-id',
      query: 'Find FDEs in enterprise software',
    })
    expect(params.apiKey).toBeUndefined()
    expect(params.operation).toBeUndefined()
    expect(params.savedSearchId).toBeUndefined()
    expect(params.savedSearchSelector).toBeUndefined()
    expect(params.savedSearchIdManual).toBeUndefined()
    expect(params.personIds).toBeUndefined()
    expect(params.personUrns).toBeUndefined()
    expect(params.size).toBeUndefined()
    expect(params.cursor).toBeUndefined()
  })

  it('coerces pagination only for paged reads', () => {
    const savedSearch = resolve({
      operation: 'harmonic_get_people_saved_search_results',
      oauthCredential: 'credential-id',
      savedSearchId: 'urn:harmonic:saved_search:123',
      size: '75',
      cursor: 'opaque-token',
    })
    expect(savedSearch.savedSearchId).toBe('urn:harmonic:saved_search:123')
    expect(savedSearch.size).toBe('75')
    expect(savedSearch.cursor).toBe('opaque-token')

    const list = resolve({
      operation: 'harmonic_list_people_saved_searches',
      oauthCredential: 'credential-id',
      size: '75',
      cursor: 'opaque-token',
    })
    expect(list.size).toBeUndefined()
    expect(list.cursor).toBeUndefined()
  })

  it('passes batch identifier strings to the secret-safe tool boundary and preserves arrays', () => {
    const parsed = resolve({
      operation: 'harmonic_batch_get_people',
      oauthCredential: 'credential-id',
      personIds: '[22,1690]',
      personUrns: '["urn:harmonic:person:44"]',
    })
    expect(parsed.personIds).toBe('[22,1690]')
    expect(parsed.personUrns).toBe('["urn:harmonic:person:44"]')

    const direct = resolve({
      operation: 'harmonic_batch_get_people',
      oauthCredential: 'credential-id',
      personIds: [22],
      personUrns: ['urn:harmonic:person:44'],
    })
    expect(direct.personIds).toEqual([22])
    expect(direct.personUrns).toEqual(['urn:harmonic:person:44'])
  })

  it('does not parse malformed batch JSON before the secret-safe tool boundary', () => {
    expect(
      resolve({
        operation: 'harmonic_batch_get_people',
        oauthCredential: 'credential-id',
        personUrns: '[not-json]',
      }).personUrns
    ).toBe('[not-json]')
  })

  it('declares stable contact outputs for every contact-producing operation', () => {
    const contactCondition = HarmonicBlock.outputs.contacts.condition as {
      value: string[]
    }
    expect(new Set(contactCondition.value)).toEqual(
      new Set([
        'harmonic_search_people_scout',
        'harmonic_get_people_saved_search_results',
        'harmonic_get_people_saved_search_net_new_results',
        'harmonic_batch_get_people',
      ])
    )
    expect(HarmonicBlock.outputs.contacts.description).toContain('personUrn')
    expect(HarmonicBlock.outputs.contacts.description).toContain('linkedinUrl')
    expect(HarmonicBlock.outputs.contacts.type).toBe('array')
    expect(HarmonicBlock.outputs.savedSearches.type).toBe('array')
    expect(HarmonicBlock.outputs.personUrns.type).toBe('array')
    expect(HarmonicBlock.outputs.pageInfo.type).toBe('json')
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
