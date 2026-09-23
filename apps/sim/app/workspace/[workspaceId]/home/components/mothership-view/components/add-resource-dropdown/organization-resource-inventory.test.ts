import { describe, expect, it, vi } from 'vitest'

vi.mock(
  '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/available-resources',
  () => ({ useAvailableResources: vi.fn() })
)

import { mergeOrganizationResourceInventories } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/organization-resource-inventory'
import { resourceFromItem } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-from-item'

const inventory = {
  groups: [
    { type: 'file' as const, items: [{ id: 'report.csv', name: 'Report' }] },
    { type: 'integration' as const, items: [{ id: 'slack', name: 'Slack' }] },
  ],
  structureFolders: { table: [], knowledgebase: [] },
  isHydrating: false,
}
describe('organization mention inventory', () => {
  it('retains explicit owners for duplicate paths, labels workspaces, and excludes unrelated inventories', () => {
    const result = mergeOrganizationResourceInventories(
      [
        { id: 'sales', name: 'Sales' },
        { id: 'finance', name: 'Finance' },
      ],
      { sales: inventory, finance: inventory, foreign: inventory }
    )
    expect(result.groups[0].items.map((item) => resourceFromItem('file', item))).toEqual([
      { type: 'file', id: 'report.csv', title: 'Report', workspaceId: 'sales' },
      { type: 'file', id: 'report.csv', title: 'Report', workspaceId: 'finance' },
    ])
    expect(result.groups[0].items.map((item) => item.workspaceName)).toEqual(['Sales', 'Finance'])
    expect(result.groups[1].items).toEqual([{ id: 'slack', name: 'Slack' }])
    expect(result.isHydrating).toBe(false)
  })
  it('keeps mention confirmation pending until every accessible workspace settles', () => {
    expect(
      mergeOrganizationResourceInventories([{ id: 'sales', name: 'Sales' }], {}).isHydrating
    ).toBe(true)
  })
})
