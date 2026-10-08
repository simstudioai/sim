import { useEffect } from 'react'
import { getChatResourceKey } from '@/lib/mothership/resources/types'
import {
  type AvailableResources,
  useAvailableResources,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/available-resources'
import { resourceFromItem } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-from-item'

/** Reuses each workspace's canonical inventory without introducing another picker. */
export function OrganizationResourceInventory({
  workspaceId,
  onChange,
}: {
  workspaceId: string
  onChange: (workspaceId: string, inventory: AvailableResources) => void
}) {
  const inventory = useAvailableResources(workspaceId, {
    includeFolderMentions: true,
    includeProjectFiles: false,
  })
  useEffect(() => {
    onChange(workspaceId, inventory)
  }, [workspaceId, inventory, onChange])
  return null
}

export function mergeOrganizationResourceInventories(
  workspaces: ReadonlyArray<{ id: string; name: string }>,
  inventories: Readonly<Record<string, AvailableResources>>,
  projects: ReadonlyArray<{ id: string }> = [],
  projectInventories: Readonly<Record<string, AvailableResources>> = {}
): AvailableResources {
  const groups: AvailableResources['groups'] = []
  const byType = new Map<string, AvailableResources['groups'][number]>()
  const structureFolders: AvailableResources['structureFolders'] = {
    table: [],
    knowledgebase: [],
    file: [],
  }
  const seen = new Set<string>()
  const seenFileFolders = new Set<string>()
  let isHydrating = false
  const sources = [
    ...projects.map((project) => ({
      inventory: projectInventories[project.id],
      workspace: undefined,
    })),
    ...workspaces.map((workspace) => ({ inventory: inventories[workspace.id], workspace })),
  ]
  for (const { inventory, workspace } of sources) {
    if (!inventory) {
      isHydrating = true
      continue
    }
    isHydrating ||= inventory.isHydrating
    const owned = (item: AvailableResources['groups'][number]['items'][number]) =>
      !workspace || item.owner?.entityType === 'project'
        ? item
        : { ...item, workspaceId: workspace.id, workspaceName: workspace.name }
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
      for (const source of group.items) {
        const item = group.type === 'integration' ? source : owned(source)
        const key = getChatResourceKey(resourceFromItem(group.type, item))
        if (seen.has(key)) continue
        seen.add(key)
        target.items.push(item)
      }
    }
    for (const item of inventory.structureFolders.file) {
      const key = getChatResourceKey(resourceFromItem('filefolder', item))
      if (seenFileFolders.has(key)) continue
      seenFileFolders.add(key)
      structureFolders.file.push(item)
    }
    structureFolders.table.push(...inventory.structureFolders.table.map(owned))
    structureFolders.knowledgebase.push(...inventory.structureFolders.knowledgebase.map(owned))
  }
  return { groups, structureFolders, isHydrating }
}
