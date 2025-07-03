import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import type { ExecutionTrigger, ExecutionEnvironment, WorkflowState } from './types'

export function createTriggerObject(
  type: ExecutionTrigger['type'],
  additionalData?: Record<string, unknown>
): ExecutionTrigger {
  return {
    type,
    source: type,
    timestamp: new Date().toISOString(),
    ...(additionalData && { data: additionalData }),
  }
}

export function createEnvironmentObject(
  workflowId: string,
  executionId: string,
  userId?: string,
  workspaceId?: string,
  variables?: Record<string, string>
): ExecutionEnvironment {
  return {
    variables: variables || {},
    workflowId,
    executionId,
    userId: userId || '',
    workspaceId: workspaceId || '',
  }
}

export async function loadWorkflowStateForExecution(workflowId: string): Promise<WorkflowState> {
  const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)

  if (!normalizedData) {
    throw new Error(
      `Workflow ${workflowId} has no normalized data available. Ensure the workflow is properly saved to normalized tables.`
    )
  }

  return {
    blocks: normalizedData.blocks || {},
    edges: normalizedData.edges || [],
    loops: normalizedData.loops || {},
    parallels: normalizedData.parallels || {},
  }
}

export function calculateBlockStats(traceSpans: any[]): {
  total: number
  success: number
  error: number
  skipped: number
} {
  if (!traceSpans || traceSpans.length === 0) {
    return { total: 0, success: 0, error: 0, skipped: 0 }
  }

  // Recursively collect all block spans from the trace span tree
  const collectBlockSpans = (spans: any[]): any[] => {
    const blocks: any[] = []

    for (const span of spans) {
      // Check if this span is an actual workflow block
      if (span.type &&
          span.type !== 'workflow' &&
          span.type !== 'provider' &&
          span.type !== 'model' &&
          span.blockId) {
        blocks.push(span)
      }

      // Recursively check children
      if (span.children && Array.isArray(span.children)) {
        blocks.push(...collectBlockSpans(span.children))
      }
    }

    return blocks
  }

  const blockSpans = collectBlockSpans(traceSpans)

  const total = blockSpans.length
  const success = blockSpans.filter((span) => span.status === 'success').length
  const error = blockSpans.filter((span) => span.status === 'error').length
  const skipped = blockSpans.filter((span) => span.status === 'skipped').length

  return { total, success, error, skipped }
}

export function calculateCostSummary(traceSpans: any[]): {
  totalCost: number
  totalInputCost: number
  totalOutputCost: number
  totalTokens: number
} {
  if (!traceSpans || traceSpans.length === 0) {
    return { totalCost: 0, totalInputCost: 0, totalOutputCost: 0, totalTokens: 0 }
  }

  let totalCost = 0
  let totalInputCost = 0
  let totalOutputCost = 0
  let totalTokens = 0

  for (const span of traceSpans) {
    if (span.cost) {
      totalCost += span.cost.total || 0
      totalInputCost += span.cost.input || 0
      totalOutputCost += span.cost.output || 0
      totalTokens += span.cost.tokens?.total || 0
    }
  }

  return { totalCost, totalInputCost, totalOutputCost, totalTokens }
}
