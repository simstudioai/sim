import type { AvailableItem } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-folder-tree'
import type {
  MothershipResource,
  MothershipResourceType,
} from '@/app/workspace/[workspaceId]/home/types'

/**
 * Builds the resource a picker row stands for.
 *
 * Every menu that selects a candidate goes through here so a family's extra
 * identifier reaches the resource. Constructing the literal inline silently
 * drops it — a log selected that way loses the execution id its chat context is
 * addressed by. Only `executionId` is carried today; add a field here when
 * another family needs one.
 */
export function resourceFromItem(
  type: MothershipResourceType,
  item: AvailableItem
): MothershipResource {
  const executionId = typeof item.executionId === 'string' ? item.executionId : undefined
  return { type, id: item.id, title: item.name, ...(executionId ? { executionId } : {}) }
}
