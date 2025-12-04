export interface WorkflowTokenResult {
  found: true
  workflowId: string
  userId: string
  arenaToken: string
}

export interface WorkflowTokenNotFound {
  found: false
  reason: string
}

export type WorkflowTokenLookup = WorkflowTokenResult | WorkflowTokenNotFound
