/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { CbInsightsBlock } from '@/blocks/blocks/cbinsights'

/**
 * Every assertion here runs against `{ ...inputs, ...buildParams(inputs) }`, the
 * shape the generic tool handler actually forwards. A key the mapper omits is
 * *not* dropped by that merge — the raw subBlock value survives — so asserting
 * on the mapper's return alone would prove nothing about what the tool receives.
 */
describe('CbInsightsBlock', () => {
  const buildParams = CbInsightsBlock.tools.config!.params!
  const selectTool = CbInsightsBlock.tools.config!.tool!

  const resolve = (inputs: Record<string, unknown>) => ({ ...inputs, ...buildParams(inputs) })

  const operationIds =
    CbInsightsBlock.subBlocks
      .find((subBlock) => subBlock.id === 'operation')
      ?.options?.map((option) => (option as { id: string }).id) ?? []

  it('maps every dropdown operation onto a registered tool', () => {
    expect(operationIds).toHaveLength(25)
    expect(new Set(operationIds.map((id) => selectTool({ operation: id })))).toEqual(
      new Set(CbInsightsBlock.tools.access)
    )
  })

  it('rejects an operation the dropdown does not offer', () => {
    expect(() => selectTool({ operation: 'get_org_secrets' })).toThrow(
      /Invalid CB Insights operation/
    )
  })

  it('gives every subblock a unique id', () => {
    const ids = CbInsightsBlock.subBlocks.map((subBlock) => subBlock.id)
    expect(ids).toHaveLength(new Set(ids).size)
  })

  it('never hides a required field behind advanced mode', () => {
    const advancedRequired = CbInsightsBlock.subBlocks
      .filter((subBlock) => subBlock.mode === 'advanced' && subBlock.required)
      .map((subBlock) => subBlock.id)

    expect(advancedRequired).toEqual([])
  })

  it('always forwards the credentials', () => {
    const params = resolve({ operation: 'chat', clientId: 'id', clientSecret: 'secret' })
    expect(params.clientId).toBe('id')
    expect(params.clientSecret).toBe('secret')
  })

  /*
   * The mapper's whole job is dropping keys that belong to another operation.
   * `shouldSerializeSubBlock` short-circuits on `mode: 'advanced'` before it
   * evaluates a condition, so a hidden advanced field still reaches `inputs` —
   * only an explicit `undefined` removes it from what goes out on the wire.
   */
  it('drops a previous operation’s leftovers when the operation changes', () => {
    const params = resolve({
      operation: 'chat',
      clientId: 'id',
      clientSecret: 'secret',
      message: 'What is growing?',
      orgId: '129410',
      orgIds: '1,2,3',
      keyword: 'fintech',
      titleIds: '50',
      startDate: '2025-01-01',
      endDate: '2025-06-01',
      limit: '50',
      nextPageToken: 'stale-token',
      names: 'CB Insights',
      sortField: 'mosaicOverall',
      minCurrentHeadcount: '10',
    })

    expect(params.message).toBe('What is growing?')
    expect(params.orgId).toBeUndefined()
    expect(params.orgIds).toBeUndefined()
    expect(params.keyword).toBeUndefined()
    expect(params.titleIds).toBeUndefined()
    expect(params.startDate).toBeUndefined()
    expect(params.endDate).toBeUndefined()
    expect(params.limit).toBeUndefined()
    expect(params.nextPageToken).toBeUndefined()
    expect(params.names).toBeUndefined()
    expect(params.sortField).toBeUndefined()
    expect(params.minCurrentHeadcount).toBeUndefined()
  })

  /*
   * Lookup and firmographics both filter on organization IDs and websites, but
   * the endpoints take different shapes, so the block gives each its own
   * subblock and the mapper folds them onto the single tool param.
   */
  it('folds the firmographics-only aliases onto the shared tool params', () => {
    const firmographics = resolve({
      operation: 'search_firmographics',
      clientId: 'id',
      clientSecret: 'secret',
      orgIdFilter: '129410, 129411',
      firmographicsUrls: 'cbinsights.com',
      urls: 'ignored-lookup-value.com',
      orgIds: 'ignored-list-value',
    })

    expect(firmographics.orgIds).toBe('129410, 129411')
    expect(firmographics.urls).toBe('cbinsights.com')
    expect(firmographics.orgIdFilter).toBeUndefined()
    expect(firmographics.firmographicsUrls).toBeUndefined()

    const lookup = resolve({
      operation: 'lookup_organizations',
      clientId: 'id',
      clientSecret: 'secret',
      urls: 'cbinsights.com',
      orgIdFilter: '129410',
      firmographicsUrls: 'wrong.com',
    })

    expect(lookup.urls).toBe('cbinsights.com')
    expect(lookup.orgIds).toBeUndefined()
  })

  it('sends the organization ID only to path-scoped operations', () => {
    const scoped = resolve({
      operation: 'get_org_outlook',
      clientId: 'id',
      clientSecret: 'secret',
      orgId: '129410',
      orgIds: '1,2',
    })
    expect(scoped.orgId).toBe('129410')
    expect(scoped.orgIds).toBeUndefined()

    const listed = resolve({
      operation: 'list_outlook',
      clientId: 'id',
      clientSecret: 'secret',
      orgId: '129410',
      orgIds: '1,2',
    })
    expect(listed.orgId).toBeUndefined()
    expect(listed.orgIds).toBe('1,2')
  })

  /*
   * Mosaic history takes a start date but no end date; the other two history
   * endpoints take both. Sending endDate to Mosaic history would be an
   * undocumented field on the wire.
   */
  it('sends only the date fields each history endpoint documents', () => {
    const mosaic = resolve({
      operation: 'get_mosaic_history',
      clientId: 'id',
      clientSecret: 'secret',
      orgId: '1',
      startDate: '2025-01-01',
      endDate: '2025-06-01',
    })
    expect(mosaic.startDate).toBe('2025-01-01')
    expect(mosaic.endDate).toBeUndefined()

    const maturity = resolve({
      operation: 'get_commercial_maturity_history',
      clientId: 'id',
      clientSecret: 'secret',
      orgId: '1',
      startDate: '2025-01-01',
      endDate: '2025-06-01',
    })
    expect(maturity.startDate).toBe('2025-01-01')
    expect(maturity.endDate).toBe('2025-06-01')
  })

  /*
   * Business relationships pages with a token but documents no `limit`, so
   * carrying one over from another operation would put an undocumented field on
   * the wire.
   */
  it('sends limit only to the operations whose endpoint documents it', () => {
    const relationships = resolve({
      operation: 'list_business_relationships',
      clientId: 'id',
      clientSecret: 'secret',
      orgIds: '1,2',
      limit: '50',
      nextPageToken: 'tok',
    })
    expect(relationships.limit).toBeUndefined()
    expect(relationships.nextPageToken).toBe('tok')

    const fundings = resolve({
      operation: 'list_fundings',
      clientId: 'id',
      clientSecret: 'secret',
      orgIds: '1,2',
      limit: '50',
    })
    expect(fundings.limit).toBe('50')
  })
})
