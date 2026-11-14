import { describe, expect, it } from 'vitest'
import { hubspotAddListMembershipsTool } from '@/tools/hubspot/add_list_memberships'

describe('HubSpot add list memberships', () => {
  it('reads the added record ids from the spec field name recordsIdsAdded', async () => {
    const transform = hubspotAddListMembershipsTool.transformResponse
    if (!transform) throw new Error('missing transformResponse')

    const result = await transform(
      Response.json({ recordsIdsAdded: ['101', '102'], recordIdsMissing: ['999'] })
    )

    expect(result.output.recordIdsAdded).toEqual(['101', '102'])
    expect(result.output.recordIdsMissing).toEqual(['999'])
  })
})
