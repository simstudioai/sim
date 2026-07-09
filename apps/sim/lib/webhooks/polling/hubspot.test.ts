/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildUserFilters } from '@/lib/webhooks/polling/hubspot'

describe('buildUserFilters', () => {
  it('translates pipeline/stage/owner shortcuts into EQ filters', () => {
    const filters = buildUserFilters({
      objectType: 'deal',
      pipelineId: 'pipeline-1',
      stageId: 'stage-1',
      ownerId: 'owner-1',
    })

    expect(filters).toEqual([
      { propertyName: 'pipeline', operator: 'EQ', value: 'pipeline-1' },
      { propertyName: 'dealstage', operator: 'EQ', value: 'stage-1' },
      { propertyName: 'hubspot_owner_id', operator: 'EQ', value: 'owner-1' },
    ])
  })

  it('uses ticket-specific pipeline/stage property names', () => {
    const filters = buildUserFilters({
      objectType: 'ticket',
      pipelineId: 'pipeline-1',
      stageId: 'stage-1',
    })

    expect(filters).toEqual([
      { propertyName: 'hs_pipeline', operator: 'EQ', value: 'pipeline-1' },
      { propertyName: 'hs_pipeline_stage', operator: 'EQ', value: 'stage-1' },
    ])
  })

  it('parses advanced JSON filters and preserves values arrays', () => {
    const filters = buildUserFilters({
      filters: JSON.stringify([
        { propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' },
        { propertyName: 'dealstage', operator: 'IN', values: ['a', 'b'] },
      ]),
    })

    expect(filters).toEqual([
      { propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' },
      { propertyName: 'dealstage', operator: 'IN', values: ['a', 'b'] },
    ])
  })

  it('drops filter entries with an unrecognized operator', () => {
    const filters = buildUserFilters({
      filters: JSON.stringify([
        { propertyName: 'amount', operator: 'STARTS_WITH', value: '1' },
        { propertyName: 'amount', operator: 'GT', value: '1' },
      ]),
    })

    expect(filters).toEqual([{ propertyName: 'amount', operator: 'GT', value: '1' }])
  })

  it('ignores malformed JSON filters without throwing', () => {
    expect(() => buildUserFilters({ filters: 'not json' })).not.toThrow()
    expect(buildUserFilters({ filters: 'not json' })).toEqual([])
  })

  it('caps combined shortcut + advanced filters at the HubSpot per-group limit', () => {
    const filters = buildUserFilters({
      objectType: 'deal',
      pipelineId: 'pipeline-1',
      stageId: 'stage-1',
      ownerId: 'owner-1',
      filters: JSON.stringify([
        { propertyName: 'amount', operator: 'GT', value: '1000' },
        { propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' },
      ]),
    })

    // 3 shortcuts + 2 advanced = 5 raw filters, capped to 4 so Group B
    // (2 reserved slots + user filters) never exceeds HubSpot's 6-filter-per-group max.
    expect(filters).toHaveLength(4)
    expect(filters).toEqual([
      { propertyName: 'pipeline', operator: 'EQ', value: 'pipeline-1' },
      { propertyName: 'dealstage', operator: 'EQ', value: 'stage-1' },
      { propertyName: 'hubspot_owner_id', operator: 'EQ', value: 'owner-1' },
      { propertyName: 'amount', operator: 'GT', value: '1000' },
    ])
  })
})
