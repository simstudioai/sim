import { useEffect } from 'react'
import {
  type AvailableResources,
  useAvailableResources,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/available-resources'
import type { MothershipResourceType } from '@/app/workspace/[workspaceId]/home/types'

/** Reuses each workspace's canonical inventory without introducing another picker. */
export function OrganizationResourceInventory({
  workspaceId,
  excludeTypes,
  fileSearch,
  onChange,
}: {
  workspaceId: string
  excludeTypes?: readonly MothershipResourceType[]
  /** The picker's query, which the workspace's files are searched by. */
  fileSearch?: string
  onChange: (workspaceId: string, inventory: AvailableResources) => void
}) {
  const inventory = useAvailableResources(workspaceId, {
    includeFolderMentions: true,
    excludeTypes,
    fileSearch,
  })
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
      // Integrations are not workspace-owned, but a permission group can target
      // individual workspaces, so one is offered only where every workspace permits it.
      const integrations = group.type === 'integration' ? byType.get(group.type) : undefined
      if (integrations) {
        const permittedHere = new Set(group.items.map((item) => item.id))
        integrations.items = integrations.items.filter((item) => permittedHere.has(item.id))
        continue
      }
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
