import { useEffect } from 'react'
import {
  type AvailableResources,
  useAvailableResources,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/available-resources'

/** Reuses each workspace's canonical inventory without introducing another picker. */
export function OrganizationResourceInventory({
  workspaceId,
  onChange,
}: {
  workspaceId: string
  onChange: (workspaceId: string, inventory: AvailableResources) => void
}) {
  const inventory = useAvailableResources(workspaceId, { includeFolderMentions: true })
  useEffect(() => {
    onChange(workspaceId, inventory)
  }, [workspaceId, inventory, onChange])
  return null
}

export function mergeOrganizationResourceInventories(
  workspaces: ReadonlyArray<{ id: string; name: string }>,
  inventories: Readonly<Record<string, AvailableResources>>
): AvailableResources {
  const groups: AvailableResources['groups'] = []
  const byType = new Map<string, AvailableResources['groups'][number]>()
  const structureFolders: AvailableResources['structureFolders'] = { table: [], knowledgebase: [] }
  let isHydrating = false
  for (const workspace of workspaces) {
    const inventory = inventories[workspace.id]
    if (!inventory) {
      isHydrating = true
      continue
    }
    isHydrating ||= inventory.isHydrating
    const owned = (item: AvailableResources['groups'][number]['items'][number]) => ({
      ...item,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    })
    for (const group of inventory.groups) {
      if (group.type === 'browser' || group.type === 'terminal') continue
      // Integration definitions are global and do not belong to a workspace.
      if (group.type === 'integration' && byType.has(group.type)) continue
      let target = byType.get(group.type)
      if (!target) {
        target = { type: group.type, items: [] }
        groups.push(target)
        byType.set(group.type, target)
      }
      target.items.push(...(group.type === 'integration' ? group.items : group.items.map(owned)))
    }
    structureFolders.table.push(...inventory.structureFolders.table.map(owned))
    structureFolders.knowledgebase.push(...inventory.structureFolders.knowledgebase.map(owned))
  }
  return { groups, structureFolders, isHydrating }
}
