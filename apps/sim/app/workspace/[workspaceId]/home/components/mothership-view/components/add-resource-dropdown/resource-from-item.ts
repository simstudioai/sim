import type { AvailableItem } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-folder-tree'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'

/** Builds the resource a picker row addresses, preserving its owner and execution context. */
export function resourceFromItem(
  type: MothershipResourceType,
  item: AvailableItem
): MothershipResource {
  const executionId = typeof item.executionId === 'string' ? item.executionId : undefined
  return {
    type,
    id: item.id,
    title: item.name,
    ...(executionId ? { executionId } : {}),
    ...(item.owner ? { owner: item.owner } : {}),
    ...(item.owner?.entityType !== 'project' && typeof item.workspaceId === 'string'
      ? { workspaceId: item.workspaceId }
      : {}),
  }
}
