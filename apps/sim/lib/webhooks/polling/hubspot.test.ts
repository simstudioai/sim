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

  it('allows exactly the HubSpot per-group limit of combined filters', () => {
    const filters = buildUserFilters({
      objectType: 'deal',
      pipelineId: 'pipeline-1',
      stageId: 'stage-1',
      ownerId: 'owner-1',
      filters: JSON.stringify([{ propertyName: 'amount', operator: 'GT', value: '1000' }]),
    })

    // 3 shortcuts + 1 advanced = 4, exactly MAX_USER_FILTERS.
    expect(filters).toHaveLength(4)
  })

  it('throws rather than silently dropping filters when the combined count exceeds the limit', () => {
    // Filters within a filterGroup are AND-combined, so silently dropping one would widen
    // the match set instead of narrowing it — throwing surfaces the misconfiguration loudly.
    expect(() =>
      buildUserFilters({
        objectType: 'deal',
        pipelineId: 'pipeline-1',
        stageId: 'stage-1',
        ownerId: 'owner-1',
        filters: JSON.stringify([
          { propertyName: 'amount', operator: 'GT', value: '1000' },
          { propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' },
        ]),
      })
    ).toThrow(/exceeding the 4-filter limit/)
  })
})
