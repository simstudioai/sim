import { db, workflow } from '@sim/db'
import { eq } from 'drizzle-orm'
import { BASE_EXECUTION_CHARGE } from '@/lib/billing/constants'
import type {
  ExecutionEnvironment,
  ExecutionTrigger,
  TraceSpan,
  WorkflowState,
} from '@/lib/logs/types'
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

type CostTraceSpan = Pick<TraceSpan, 'cost' | 'model' | 'tokens'> & {
  type?: TraceSpan['type']
  name?: TraceSpan['name']
  children?: CostTraceSpan[]
}

export interface CostSummaryModel {
  input: number
  output: number
  total: number
  toolCost?: number
  tokens: { input: number; output: number; total: number }
}

/**
 * Non-model billable charge (e.g. a standalone hosted-key tool block such as
 * Exa/Tavily/falai run outside an agent). These spans contribute to the run's
 * total cost but carry no `model`, so they live here rather than in `models`.
 * Summed per span name so the ledger has one row per integration.
 */
export interface CostSummaryCharge {
  total: number
}

export interface CostSummary {
  totalCost: number
  totalInputCost: number
  totalOutputCost: number
  totalTokens: number
  totalPromptTokens: number
  totalCompletionTokens: number
  baseExecutionCharge: number
  models: Record<string, CostSummaryModel>
  /** Non-model billable charges keyed by span name (tool/integration costs). */
  charges: Record<string, CostSummaryCharge>
}

type BillableTraceSpan = CostTraceSpan & { cost: NonNullable<TraceSpan['cost']> }

function hasBillableCost(span: CostTraceSpan): span is BillableTraceSpan {
  return span.cost !== undefined
}

function isModelBreakdownSpan(span: CostTraceSpan): boolean {
  return span.type === 'model'
}

export function calculateCostSummary(traceSpans: CostTraceSpan[] | undefined): CostSummary {
  if (!traceSpans || traceSpans.length === 0) {
    return {
      totalCost: BASE_EXECUTION_CHARGE,
      totalInputCost: 0,
      totalOutputCost: 0,
      totalTokens: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      baseExecutionCharge: BASE_EXECUTION_CHARGE,
      models: {},
      charges: {},
    }
  }

  /**
   * Collects spans that contribute to the execution's billable cost.
   *
   * Rule: when a span has its own `cost` AND has child model segments, the
   * parent's block-level cost is authoritative — skip the model children to
   * avoid double-counting. The parent cost is set by the provider response
   * (and is correctly zeroed by `executeProviderRequest` for BYOK calls);
   * model children only carry per-segment cost from the trace enrichers,
   * which is unaware of BYOK status. Non-model children are still visited
   * so standalone nested costs remain billable.
   *
   * Spans without their own `cost` (e.g. parent workflow spans for
   * subworkflow blocks) still recurse so nested billable spans are counted.
   */
  const collectCostSpans = (spans: CostTraceSpan[]): BillableTraceSpan[] => {
    const costSpans: BillableTraceSpan[] = []

    for (const span of spans) {
      // `workflow`-typed spans are aggregate containers, not billable units: the
      // synthetic "Workflow Execution" root (added to every run by
      // buildTraceSpans) and any nested sub-workflow root carry a `cost.total`
      // equal to the SUM of their descendants. Counting that aggregate in
      // addition to the descendants double-charges the run, so treat these as
      // pass-through: never count their own cost, always recurse into all
      // children where the real billable leaves (agents, tools) live.
      const isAggregateContainer = span.type === 'workflow'
      const hasOwnCost = hasBillableCost(span)
      const countOwnCost = hasOwnCost && !isAggregateContainer

      if (countOwnCost) {
        costSpans.push(span)
      }

      if (span.children && Array.isArray(span.children)) {
        if (countOwnCost) {
          // Authoritative leaf (e.g. an agent block whose block-level cost is set
          // by the provider response and already accounts for its model
          // segments): only recurse into non-model children to find further
          // standalone billable units, skipping the model-breakdown duplicates.
          const nonModelChildren = span.children.filter((child) => !isModelBreakdownSpan(child))
          costSpans.push(...collectCostSpans(nonModelChildren))
        } else {
          // Container (workflow / sub-workflow root) or a no-cost parent: recurse
          // into everything so nested billable leaves are counted exactly once.
          costSpans.push(...collectCostSpans(span.children))
        }
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
  const models: Record<string, CostSummaryModel> = {}
  const charges: Record<string, CostSummaryCharge> = {}

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

      if (span.cost.toolCost) {
        models[model].toolCost = (models[model].toolCost || 0) + span.cost.toolCost
      }
    } else if ((span.cost.total || 0) > 0) {
      // Non-model billable span (e.g. a standalone hosted-key tool block).
      // These previously contributed to the run total but were never itemized
      // in the ledger (the "standalone tool gap"). Key by span name so each
      // integration gets a single, reconciling charge row.
      const description = span.name || span.type || 'tool'
      if (!charges[description]) {
        charges[description] = { total: 0 }
      }
      charges[description].total += span.cost.total || 0
    }
  }

  totalCost += BASE_EXECUTION_CHARGE

  return {
    totalCost,
    totalInputCost,
    totalOutputCost,
    totalTokens,
    totalPromptTokens,
    totalCompletionTokens,
    baseExecutionCharge: BASE_EXECUTION_CHARGE,
    models,
    charges,
  }
}
