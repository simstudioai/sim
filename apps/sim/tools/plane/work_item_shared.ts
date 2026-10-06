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
    description:
      'Work item description as HTML (e.g., "<p>Steps to reproduce</p>"). Leave empty to keep the current description',
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

/**
 * Fields Update Work Item can clear, mapped to the request key and the value Plane stores for
 * "empty". Plane rejects an empty description string as invalid HTML, so its empty value is the
 * same `<p></p>` Plane uses as the default.
 */
const PLANE_CLEARABLE_FIELDS = {
  description: ['description_html', '<p></p>'],
  assigneeIds: ['assignees', []],
  labelIds: ['labels', []],
  parentId: ['parent', null],
  startDate: ['start_date', null],
  targetDate: ['target_date', null],
  estimatePointId: ['estimate_point', null],
  typeId: ['type_id', null],
} as const satisfies Record<string, readonly [string, unknown]>

type PlaneClearableField = keyof typeof PLANE_CLEARABLE_FIELDS

export const PLANE_CLEARABLE_FIELD_NAMES = Object.keys(
  PLANE_CLEARABLE_FIELDS
) as PlaneClearableField[]

function isClearableField(value: string): value is PlaneClearableField {
  return Object.hasOwn(PLANE_CLEARABLE_FIELDS, value)
}

/**
 * Applies `clearFields` to an update body. Clearing is explicit rather than inferred from an empty
 * input, because an untouched or blanked canvas field must leave the stored value alone.
 */
export function applyPlaneClearFields(
  body: Record<string, unknown>,
  clearFields: unknown
): Record<string, unknown> {
  const requested = parsePlaneIdList(clearFields) ?? []
  for (const field of requested) {
    if (!isClearableField(field)) {
      throw new Error(
        `Cannot clear "${field}". Clearable fields: ${PLANE_CLEARABLE_FIELD_NAMES.join(', ')}`
      )
    }
    const [key, emptyValue] = PLANE_CLEARABLE_FIELDS[field]
    if (body[key] !== undefined) {
      throw new Error(`"${field}" is both set and cleared; choose one`)
    }
    body[key] = Array.isArray(emptyValue) ? [] : emptyValue
  }
  return body
}
