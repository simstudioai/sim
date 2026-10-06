import { filterUndefined } from '@sim/utils/object'
import type { PlaneCreateWorkItemParams, PlaneUpdateWorkItemParams } from '@/tools/plane/types'
import { optionalTrimmed, parsePlaneIdList } from '@/tools/plane/utils'
import type { ToolConfig } from '@/tools/types'

/** Editable work item fields shared by Create Work Item and Update Work Item. */
export const PLANE_WORK_ITEM_FIELD_PARAMS = {
  description: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Work item description as HTML (e.g., "<p>Steps to reproduce</p>")',
  },
  stateId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'State ID (UUID). Use List States to find state IDs',
  },
  priority: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Priority: urgent, high, medium, low, or none',
  },
  assigneeIds: {
    type: 'array',
    required: false,
    visibility: 'user-or-llm',
    description:
      'User IDs to assign (UUIDs of active project members). On update, replaces all assignees',
    items: { type: 'string', description: 'User ID (UUID)' },
  },
  labelIds: {
    type: 'array',
    required: false,
    visibility: 'user-or-llm',
    description: 'Label IDs to apply (UUIDs from this project). On update, replaces all labels',
    items: { type: 'string', description: 'Label ID (UUID)' },
  },
  parentId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Parent work item ID (UUID) to nest this work item under',
  },
  startDate: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Start date in YYYY-MM-DD format',
  },
  targetDate: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Target (due) date in YYYY-MM-DD format',
  },
  estimatePointId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Estimate point ID (UUID)',
  },
  typeId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Work item type ID (UUID), for projects with work item types enabled',
  },
} satisfies ToolConfig['params']

/** Maps the shared editable fields onto Plane's work item request body. */
export function buildPlaneWorkItemBody(
  params: PlaneCreateWorkItemParams | PlaneUpdateWorkItemParams
): Record<string, unknown> {
  const description = typeof params.description === 'string' ? params.description : undefined
  return filterUndefined({
    name: optionalTrimmed(params.name),
    description_html: description?.trim() ? description : undefined,
    state: optionalTrimmed(params.stateId),
    priority: optionalTrimmed(params.priority),
    assignees: parsePlaneIdList(params.assigneeIds),
    labels: parsePlaneIdList(params.labelIds),
    parent: optionalTrimmed(params.parentId),
    start_date: optionalTrimmed(params.startDate),
    target_date: optionalTrimmed(params.targetDate),
    estimate_point: optionalTrimmed(params.estimatePointId),
    type_id: optionalTrimmed(params.typeId),
  })
}
