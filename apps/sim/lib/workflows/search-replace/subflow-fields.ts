export const WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS = {
  type: 'subflowType',
  iterations: 'subflowIterations',
  items: 'subflowItems',
  condition: 'subflowCondition',
} as const

export type WorkflowSearchSubflowFieldId =
  (typeof WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS)[keyof typeof WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS]
