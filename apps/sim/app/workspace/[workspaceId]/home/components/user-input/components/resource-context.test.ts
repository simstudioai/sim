import { describe, expect, it } from 'vitest'
import { mapResourceToContext } from '@/app/workspace/[workspaceId]/home/components/user-input/components/constants'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'

function resource(partial: Partial<MothershipResource> & Pick<MothershipResource, 'type'>) {
  return { id: 'id-1', title: 'Something', ...partial } as MothershipResource
}

describe('mapResourceToContext', () => {
  it('does not treat a search tab as retrieved document evidence', () => {
    expect(mapResourceToContext(resource({ type: 'search', title: 'Search results' }))).toBeNull()
  })

  it('keeps the saved view when a table is attached explicitly', () => {
    expect(
      mapResourceToContext(
        resource({
          type: 'table',
          id: 'table-1',
          title: 'Leads',
          viewId: 'qualified-view',
        })
      )
    ).toEqual({ kind: 'table', tableId: 'table-1', label: 'Leads', viewId: 'qualified-view' })
  })
})
