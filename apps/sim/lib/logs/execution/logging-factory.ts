import { db, workflow } from '@sim/db'
import { eq } from 'drizzle-orm'
import { BASE_EXECUTION_CHARGE } from '@/lib/billing/constants'
import type { ExecutionEnvironment, ExecutionTrigger, WorkflowState } from '@/lib/logs/types'
import {
  loadDeployedWorkflowState,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/persistence/utils'

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
  const [normalizedData, workflowRecord] = await Promise.all([
    loadWorkflowFromNormalizedTables(workflowId),
    db
      .select({ variables: workflow.variables })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)
      .then((rows) => rows[0]),
  ])

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
    variables: (workflowRecord?.variables as WorkflowState['variables']) || undefined,
  }
}

/**
 * Load deployed workflow state for logging purposes.
 * This fetches the active deployment state, ensuring logs capture
 * the exact state that was executed (not the live editor state).
 */
export async function loadDeployedWorkflowStateForLogging(
  workflowId: string
): Promise<WorkflowState> {
  const deployedData = await loadDeployedWorkflowState(workflowId)

  return {
    blocks: deployedData.blocks || {},
    edges: deployedData.edges || [],
    loops: deployedData.loops || {},
    parallels: deployedData.parallels || {},
    variables: deployedData.variables as WorkflowState['variables'],
  }
}

export function calculateCostSummary(traceSpans: any[]): {
  totalCost: number
  totalInputCost: number
  totalOutputCost: number
  totalTokens: number
  totalPromptTokens: number
  totalCompletionTokens: number
  baseExecutionCharge: number
  modelCost: number
  models: Record<
    string,
    {
      input: number
      output: number
      total: number
      tokens: { input: number; output: number; total: number }
    }
  >
} {
  if (!traceSpans || traceSpans.length === 0) {
    return {
      totalCost: BASE_EXECUTION_CHARGE,
      totalInputCost: 0,
      totalOutputCost: 0,
      totalTokens: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      baseExecutionCharge: BASE_EXECUTION_CHARGE,
      modelCost: 0,
      models: {},
    }
  }

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
      tokens: { input: number; output: number; total: number }
    }
  > = {}

  for (const span of costSpans) {
    totalCost += span.cost.total || 0
    totalInputCost += span.cost.input || 0
    totalOutputCost += span.cost.output || 0
    totalTokens += span.tokens?.total || 0
    totalPromptTokens += span.tokens?.input ?? span.tokens?.prompt ?? 0
    totalCompletionTokens += span.tokens?.output ?? span.tokens?.completion ?? 0

    if (span.model) {
      const model = span.model
      if (!models[model]) {
        models[model] = {
          input: 0,
          output: 0,
          total: 0,
          tokens: { input: 0, output: 0, total: 0 },
        }
      }
      models[model].input += span.cost.input || 0
      models[model].output += span.cost.output || 0
      models[model].total += span.cost.total || 0
      models[model].tokens.input += span.tokens?.input ?? span.tokens?.prompt ?? 0
      models[model].tokens.output += span.tokens?.output ?? span.tokens?.completion ?? 0
      models[model].tokens.total += span.tokens?.total || 0
    }
  }

  const modelCost = totalCost
  totalCost += BASE_EXECUTION_CHARGE

  return {
    totalCost,
    totalInputCost,
    totalOutputCost,
    totalTokens,
    totalPromptTokens,
    totalCompletionTokens,
    baseExecutionCharge: BASE_EXECUTION_CHARGE,
    modelCost,
    models,
  }
}
