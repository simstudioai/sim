import type { SubBlockType } from '@sim/workflow-types/blocks'

export const WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS = {
  type: 'subflowType',
  iterations: 'subflowIterations',
  items: 'subflowItems',
  condition: 'subflowCondition',
} as const

export type WorkflowSearchSubflowFieldId =
  (typeof WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS)[keyof typeof WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS]

export type WorkflowSearchSubflowEditableValue = string | number

interface WorkflowSearchSubflowBlock {
  type: string
  data?: {
    loopType?: string
    parallelType?: string
    count?: unknown
    collection?: unknown
    whileCondition?: unknown
    doWhileCondition?: unknown
  }
}

export interface WorkflowSearchSubflowField {
  id: WorkflowSearchSubflowFieldId
  title: string
  type: SubBlockType
  value: string
  editable: boolean
  valueKind: 'number' | 'text' | 'enum'
  reason?: string
}

export function getWorkflowSearchSubflowFields(
  block: WorkflowSearchSubflowBlock
): WorkflowSearchSubflowField[] {
  if (block.type === 'loop') {
    const loopType = block.data?.loopType ?? 'for'
    const fields: WorkflowSearchSubflowField[] = [
      {
        id: WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.type,
        title: 'Loop Type',
        type: 'combobox',
        value: String(loopType),
        editable: false,
        valueKind: 'enum',
        reason: 'Subflow type is changed from the block sidebar',
      },
    ]

    if (loopType === 'for') {
      fields.push({
        id: WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.iterations,
        title: 'Loop Iterations',
        type: 'short-input',
        value: String(block.data?.count ?? 5),
        editable: true,
        valueKind: 'number',
      })
    } else if (loopType === 'forEach') {
      fields.push({
        id: WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.items,
        title: 'Collection Items',
        type: 'code',
        value: String(block.data?.collection ?? ''),
        editable: true,
        valueKind: 'text',
      })
    } else {
      fields.push({
        id: WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.condition,
        title: 'While Condition',
        type: 'code',
        value: String(
          loopType === 'doWhile'
            ? (block.data?.doWhileCondition ?? '')
            : (block.data?.whileCondition ?? '')
        ),
        editable: true,
        valueKind: 'text',
      })
    }

    return fields
  }

  if (block.type === 'parallel') {
    const parallelType = block.data?.parallelType ?? 'count'
    return [
      {
        id: WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.type,
        title: 'Parallel Type',
        type: 'combobox',
        value: String(parallelType),
        editable: false,
        valueKind: 'enum',
        reason: 'Subflow type is changed from the block sidebar',
      },
      {
        id:
          parallelType === 'count'
            ? WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.iterations
            : WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.items,
        title: parallelType === 'count' ? 'Parallel Iterations' : 'Parallel Items',
        type: parallelType === 'count' ? 'short-input' : 'code',
        value:
          parallelType === 'count'
            ? String(block.data?.count ?? 5)
            : String(block.data?.collection ?? ''),
        editable: true,
        valueKind: parallelType === 'count' ? 'number' : 'text',
      },
    ]
  }

  return []
}

export function getWorkflowSearchSubflowField(
  block: WorkflowSearchSubflowBlock,
  fieldId: WorkflowSearchSubflowFieldId
) {
  return getWorkflowSearchSubflowFields(block).find((field) => field.id === fieldId)
}

export function workflowSearchSubflowFieldMatchesExpected(
  block: WorkflowSearchSubflowBlock,
  fieldId: WorkflowSearchSubflowFieldId,
  expectedValue: unknown
): boolean {
  const field = getWorkflowSearchSubflowField(block, fieldId)
  return Boolean(field && String(field.value) === String(expectedValue))
}

export function parseWorkflowSearchSubflowReplacement({
  blockType,
  fieldId,
  replacement,
}: {
  blockType: 'loop' | 'parallel'
  fieldId: WorkflowSearchSubflowFieldId
  replacement: string
}):
  | { success: true; value: WorkflowSearchSubflowEditableValue }
  | { success: false; reason: string } {
  if (fieldId !== WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.iterations) {
    return { success: true, value: replacement }
  }

  const trimmed = replacement.trim()
  if (!/^\d+$/.test(trimmed)) {
    return { success: false, reason: 'Subflow iteration count must be a whole number' }
  }

  const count = Number.parseInt(trimmed, 10)
  const max = blockType === 'parallel' ? 20 : 1000
  if (count < 1 || count > max) {
    return {
      success: false,
      reason: `Subflow iteration count must be between 1 and ${max}`,
    }
  }

  return { success: true, value: count }
}
