import type { ExecutionEnvironment, ExecutionTrigger, WorkflowState } from '@/lib/logs/types'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'

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

export function calculateCostSummary(traceSpans: any[]): {
  totalCost: number
  totalInputCost: number
  totalOutputCost: number
  totalTokens: number
  totalPromptTokens: number
  totalCompletionTokens: number
  models: Record<
    string,
    {
      input: number
      output: number
      total: number
      tokens: { prompt: number; completion: number; total: number }
    }
  >
} {
  if (!traceSpans || traceSpans.length === 0) {
    return {
      totalCost: 0,
      totalInputCost: 0,
      totalOutputCost: 0,
      totalTokens: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      models: {},
    }
  }

  // Recursively collect all spans with cost information from the trace span tree
  const collectCostSpans = (spans: any[]): any[] => {
    const costSpans: any[] = []

    for (const span of spans) {
      if (span.cost) {
        costSpans.push(span)
      }

      if (span.children && Array.isArray(span.children)) {
        costSpans.push(...collectCostSpans(span.children))
      }
    }

    return costSpans
  }

  const costSpans = collectCostSpans(traceSpans)

  let totalCost = 0
  let totalInputCost = 0
  let totalOutputCost = 0
  let totalTokens = 0
  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  const models: Record<
    string,
    {
      input: number
      output: number
      total: number
      tokens: { prompt: number; completion: number; total: number }
    }
  > = {}

  for (const span of costSpans) {
    totalCost += span.cost.total || 0
    totalInputCost += span.cost.input || 0
    totalOutputCost += span.cost.output || 0
    // Tokens are at span.tokens, not span.cost.tokens
    totalTokens += span.tokens?.total || 0
    totalPromptTokens += span.tokens?.prompt || 0
    totalCompletionTokens += span.tokens?.completion || 0

    // Aggregate model-specific costs - model is at span.model, not span.cost.model
    if (span.model) {
      const model = span.model
      if (!models[model]) {
        models[model] = {
          input: 0,
          output: 0,
          total: 0,
          tokens: { prompt: 0, completion: 0, total: 0 },
        }
      }
      models[model].input += span.cost.input || 0
      models[model].output += span.cost.output || 0
      models[model].total += span.cost.total || 0
      // Tokens are at span.tokens, not span.cost.tokens
      models[model].tokens.prompt += span.tokens?.prompt || 0
      models[model].tokens.completion += span.tokens?.completion || 0
      models[model].tokens.total += span.tokens?.total || 0
    }
  }

  return {
    totalCost,
    totalInputCost,
    totalOutputCost,
    totalTokens,
    totalPromptTokens,
    totalCompletionTokens,
    models,
  }
}
