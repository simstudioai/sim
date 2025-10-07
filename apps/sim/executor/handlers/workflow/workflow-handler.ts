import { generateInternalToken } from '@/lib/auth/internal'
import { createLogger } from '@/lib/logs/console/logger'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import type { TraceSpan } from '@/lib/logs/types'
import { getBaseUrl } from '@/lib/urls/utils'
import type { BlockOutput } from '@/blocks/types'
import { Executor } from '@/executor'
import { BlockType } from '@/executor/consts'
import type {
  BlockHandler,
  ExecutionContext,
  ExecutionResult,
  StreamingExecution,
} from '@/executor/types'
import { Serializer } from '@/serializer'
import type { SerializedBlock } from '@/serializer/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkflowBlockHandler')

type WorkflowTraceSpan = TraceSpan & {
  metadata?: Record<string, unknown>
  children?: WorkflowTraceSpan[]
  output?: (Record<string, unknown> & { childTraceSpans?: WorkflowTraceSpan[] }) | null
}

// Maximum allowed depth for nested workflow executions
const MAX_WORKFLOW_DEPTH = 10

/**
 * Handler for workflow blocks that execute other workflows inline.
 * Creates sub-execution contexts and manages data flow between parent and child workflows.
 */
export class WorkflowBlockHandler implements BlockHandler {
  private serializer = new Serializer()

  // Tolerant JSON parser for mapping values
  // Keeps handler self-contained without introducing utilities
  private safeParse(input: unknown): unknown {
    if (typeof input !== 'string') return input
    try {
      return JSON.parse(input)
    } catch {
      return input
    }
  }

  canHandle(block: SerializedBlock): boolean {
    const id = block.metadata?.id
    return id === BlockType.WORKFLOW || id === 'workflow_input'
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput | StreamingExecution> {
    logger.info(`Executing workflow block: ${block.id}`)

    const workflowId = inputs.workflowId

    if (!workflowId) {
      throw new Error('No workflow selected for execution')
    }

    try {
      // Check execution depth
      const currentDepth = (context.workflowId?.split('_sub_').length || 1) - 1
      if (currentDepth >= MAX_WORKFLOW_DEPTH) {
        throw new Error(`Maximum workflow nesting depth of ${MAX_WORKFLOW_DEPTH} exceeded`)
      }

      // In deployed contexts, enforce that child workflow has an active deployment
      if (context.isDeployedContext) {
        const hasActiveDeployment = await this.checkChildDeployment(workflowId)
        if (!hasActiveDeployment) {
          throw new Error(
            `Child workflow is not deployed. Please deploy the workflow before invoking it.`
          )
        }
      }

      // Load the child workflow
      const childWorkflow = context.isDeployedContext
        ? await this.loadChildWorkflowDeployed(workflowId)
        : await this.loadChildWorkflow(workflowId)

      if (!childWorkflow) {
        throw new Error(`Child workflow ${workflowId} not found`)
      }

      // Get workflow metadata for logging
      const { workflows } = useWorkflowRegistry.getState()
      const workflowMetadata = workflows[workflowId]
      const childWorkflowName = workflowMetadata?.name || childWorkflow.name || 'Unknown Workflow'

      logger.info(
        `Executing child workflow: ${childWorkflowName} (${workflowId}) at depth ${currentDepth}`
      )

      // Prepare the input for the child workflow
      // Prefer structured mapping if provided; otherwise fall back to legacy 'input' passthrough
      let childWorkflowInput: Record<string, any> = {}

      if (inputs.inputMapping !== undefined && inputs.inputMapping !== null) {
        // Handle inputMapping - could be object or stringified JSON
        const raw = inputs.inputMapping
        const normalized = this.safeParse(raw)

        if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
          childWorkflowInput = normalized as Record<string, any>
        } else {
          childWorkflowInput = {}
        }
      } else if (inputs.input !== undefined) {
        // Legacy behavior: pass under start.input
        childWorkflowInput = inputs.input
      }

      // Remove the workflowId from the input to avoid confusion
      const { workflowId: _, input: __, ...otherInputs } = inputs

      // Execute child workflow inline
      const subExecutor = new Executor({
        workflow: childWorkflow.serializedState,
        workflowInput: childWorkflowInput,
        envVarValues: context.environmentVariables,
        workflowVariables: childWorkflow.variables || {},
        contextExtensions: {
          isChildExecution: true, // Prevent child executor from managing global state
          // Propagate deployed context down to child execution so nested children obey constraints
          isDeployedContext: context.isDeployedContext === true,
        },
      })

      const startTime = performance.now()
      // Use the actual child workflow ID for authentication, not the execution ID
      // This ensures knowledge base and other API calls can properly authenticate
      const result = await subExecutor.execute(workflowId)
      const executionResult = this.toExecutionResult(result)
      const duration = performance.now() - startTime

      logger.info(`Child workflow ${childWorkflowName} completed in ${Math.round(duration)}ms`)

      const childTraceSpans = this.captureChildWorkflowLogs(
        executionResult,
        childWorkflowName,
        context
      )

      const mappedResult = this.mapChildOutputToParent(
        executionResult,
        workflowId,
        childWorkflowName,
        duration,
        childTraceSpans
      )

      if ((mappedResult as any).success === false) {
        const childError = (mappedResult as any).error || 'Unknown error'
        const errorWithSpans = new Error(
          `Error in child workflow "${childWorkflowName}": ${childError}`
        ) as any
        // Attach trace spans and name for higher-level logging to consume
        errorWithSpans.childTraceSpans = childTraceSpans
        errorWithSpans.childWorkflowName = childWorkflowName
        errorWithSpans.executionResult = executionResult
        throw errorWithSpans
      }

      return mappedResult
    } catch (error: any) {
      logger.error(`Error executing child workflow ${workflowId}:`, error)

      const { workflows } = useWorkflowRegistry.getState()
      const workflowMetadata = workflows[workflowId]
      const childWorkflowName = workflowMetadata?.name || workflowId

      const originalError = error.message || 'Unknown error'
      if (originalError.startsWith('Error in child workflow')) {
        throw error // Re-throw as-is to avoid duplication
      }

      const wrappedError = new Error(
        `Error in child workflow "${childWorkflowName}": ${originalError}`
      ) as any
      if (error.childTraceSpans) {
        wrappedError.childTraceSpans = error.childTraceSpans
      }
      if (error.childWorkflowName) {
        wrappedError.childWorkflowName = error.childWorkflowName
      }
      if (error.executionResult) {
        wrappedError.executionResult = error.executionResult
      }
      throw wrappedError
    }
  }

  /**
   * Loads a child workflow from the API
   */
  private async loadChildWorkflow(workflowId: string) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (typeof window === 'undefined') {
      const token = await generateInternalToken()
      headers.Authorization = `Bearer ${token}`
    }

    const response = await fetch(`${getBaseUrl()}/api/workflows/${workflowId}`, {
      headers,
    })

    if (!response.ok) {
      if (response.status === 404) {
        logger.warn(`Child workflow ${workflowId} not found`)
        return null
      }
      throw new Error(`Failed to fetch workflow: ${response.status} ${response.statusText}`)
    }

    const { data: workflowData } = await response.json()

    if (!workflowData) {
      throw new Error(`Child workflow ${workflowId} returned empty data`)
    }

    logger.info(`Loaded child workflow: ${workflowData.name} (${workflowId})`)
    const workflowState = workflowData.state

    if (!workflowState || !workflowState.blocks) {
      throw new Error(`Child workflow ${workflowId} has invalid state`)
    }
    // Important: do not swallow serialization/validation errors
    const serializedWorkflow = this.serializer.serializeWorkflow(
      workflowState.blocks,
      workflowState.edges || [],
      workflowState.loops || {},
      workflowState.parallels || {},
      true // Enable validation during execution
    )

    const workflowVariables = (workflowData.variables as Record<string, any>) || {}

    if (Object.keys(workflowVariables).length > 0) {
      logger.info(
        `Loaded ${Object.keys(workflowVariables).length} variables for child workflow: ${workflowId}`
      )
    } else {
      logger.debug(`No workflow variables found for child workflow: ${workflowId}`)
    }

    return {
      name: workflowData.name,
      serializedState: serializedWorkflow,
      variables: workflowVariables,
    }
  }

  /**
   * Checks if a workflow has an active deployed version
   */
  private async checkChildDeployment(workflowId: string): Promise<boolean> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (typeof window === 'undefined') {
        const token = await generateInternalToken()
        headers.Authorization = `Bearer ${token}`
      }
      const response = await fetch(`${getBaseUrl()}/api/workflows/${workflowId}/deployed`, {
        headers,
        cache: 'no-store',
      })
      if (!response.ok) return false
      const json = await response.json()
      // API returns { deployedState: state | null }
      return !!json?.data?.deployedState || !!json?.deployedState
    } catch (e) {
      logger.error(`Failed to check child deployment for ${workflowId}:`, e)
      return false
    }
  }

  /**
   * Loads child workflow using deployed state (for API/webhook/schedule/chat executions)
   */
  private async loadChildWorkflowDeployed(workflowId: string) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (typeof window === 'undefined') {
      const token = await generateInternalToken()
      headers.Authorization = `Bearer ${token}`
    }

    // Fetch deployed state
    const deployedRes = await fetch(`${getBaseUrl()}/api/workflows/${workflowId}/deployed`, {
      headers,
      cache: 'no-store',
    })
    if (!deployedRes.ok) {
      if (deployedRes.status === 404) {
        return null
      }
      throw new Error(
        `Failed to fetch deployed workflow: ${deployedRes.status} ${deployedRes.statusText}`
      )
    }
    const deployedJson = await deployedRes.json()
    const deployedState = deployedJson?.data?.deployedState || deployedJson?.deployedState
    if (!deployedState || !deployedState.blocks) {
      throw new Error(`Deployed state missing or invalid for child workflow ${workflowId}`)
    }

    // Fetch variables and name from live metadata (variables are not stored in deployments)
    const metaRes = await fetch(`${getBaseUrl()}/api/workflows/${workflowId}`, {
      headers,
      cache: 'no-store',
    })
    if (!metaRes.ok) {
      throw new Error(`Failed to fetch workflow metadata: ${metaRes.status} ${metaRes.statusText}`)
    }
    const metaJson = await metaRes.json()
    const wfData = metaJson?.data

    // Important: do not swallow serialization/validation errors
    const serializedWorkflow = this.serializer.serializeWorkflow(
      deployedState.blocks,
      deployedState.edges || [],
      deployedState.loops || {},
      deployedState.parallels || {},
      true
    )

    const workflowVariables = (wfData?.variables as Record<string, any>) || {}

    return {
      name: wfData?.name || 'Workflow',
      serializedState: serializedWorkflow,
      variables: workflowVariables,
    }
  }

  /**
   * Captures and transforms child workflow logs into trace spans
   */
  private captureChildWorkflowLogs(
    childResult: ExecutionResult,
    childWorkflowName: string,
    parentContext: ExecutionContext
  ): WorkflowTraceSpan[] {
    try {
      if (!childResult.logs || !Array.isArray(childResult.logs)) {
        return []
      }

      const { traceSpans } = buildTraceSpans(childResult)

      if (!traceSpans || traceSpans.length === 0) {
        return []
      }

      const processedSpans = this.processChildWorkflowSpans(traceSpans)

      if (processedSpans.length === 0) {
        return []
      }

      const transformedSpans = processedSpans.map((span) =>
        this.transformSpanForChildWorkflow(span, childWorkflowName)
      )

      return transformedSpans
    } catch (error) {
      logger.error(`Error capturing child workflow logs for ${childWorkflowName}:`, error)
      return []
    }
  }

  /**
   * Transforms trace span for child workflow context
   */
  private transformSpanForChildWorkflow(
    span: WorkflowTraceSpan,
    childWorkflowName: string
  ): WorkflowTraceSpan {
    const metadata: Record<string, unknown> = {
      ...(span.metadata ?? {}),
      isFromChildWorkflow: true,
      childWorkflowName,
    }

    const transformedChildren = Array.isArray(span.children)
      ? span.children.map((childSpan) =>
          this.transformSpanForChildWorkflow(childSpan, childWorkflowName)
        )
      : undefined

    return {
      ...span,
      metadata,
      ...(transformedChildren ? { children: transformedChildren } : {}),
    }
  }

  private processChildWorkflowSpans(spans: TraceSpan[]): WorkflowTraceSpan[] {
    const processed: WorkflowTraceSpan[] = []

    spans.forEach((span) => {
      if (this.isSyntheticWorkflowWrapper(span)) {
        if (span.children && Array.isArray(span.children)) {
          processed.push(...this.processChildWorkflowSpans(span.children))
        }
        return
      }

      const workflowSpan: WorkflowTraceSpan = {
        ...span,
      }

      if (Array.isArray(workflowSpan.children)) {
        workflowSpan.children = this.processChildWorkflowSpans(workflowSpan.children as TraceSpan[])
      }

      processed.push(workflowSpan)
    })

    return processed
  }

  private flattenChildWorkflowSpans(spans: TraceSpan[]): WorkflowTraceSpan[] {
    const flattened: WorkflowTraceSpan[] = []

    spans.forEach((span) => {
      if (this.isSyntheticWorkflowWrapper(span)) {
        if (span.children && Array.isArray(span.children)) {
          flattened.push(...this.flattenChildWorkflowSpans(span.children))
        }
        return
      }

      const workflowSpan: WorkflowTraceSpan = {
        ...span,
      }

      if (Array.isArray(workflowSpan.children)) {
        const childSpans = workflowSpan.children as TraceSpan[]
        workflowSpan.children = this.flattenChildWorkflowSpans(childSpans)
      }

      if (workflowSpan.output && typeof workflowSpan.output === 'object') {
        const { childTraceSpans: nestedChildSpans, ...outputRest } = workflowSpan.output as {
          childTraceSpans?: TraceSpan[]
        } & Record<string, unknown>

        if (Array.isArray(nestedChildSpans) && nestedChildSpans.length > 0) {
          const flattenedNestedChildren = this.flattenChildWorkflowSpans(nestedChildSpans)
          workflowSpan.children = [...(workflowSpan.children || []), ...flattenedNestedChildren]
        }

        workflowSpan.output = outputRest
      }

      flattened.push(workflowSpan)
    })

    return flattened
  }

  private toExecutionResult(result: ExecutionResult | StreamingExecution): ExecutionResult {
    return 'execution' in result ? result.execution : result
  }

  private isSyntheticWorkflowWrapper(span: TraceSpan | undefined): boolean {
    if (!span || span.type !== 'workflow') return false
    return !span.blockId
  }

  /**
   * Maps child workflow output to parent block output
   */
  private mapChildOutputToParent(
    childResult: ExecutionResult,
    childWorkflowId: string,
    childWorkflowName: string,
    duration: number,
    childTraceSpans?: WorkflowTraceSpan[]
  ): BlockOutput {
    const success = childResult.success !== false
    if (!success) {
      logger.warn(`Child workflow ${childWorkflowName} failed`)
      const failure: Record<string, any> = {
        success: false,
        childWorkflowName,
        error: childResult.error || 'Child workflow execution failed',
      }
      // Only include spans when present to keep output stable for callers/tests
      if (Array.isArray(childTraceSpans) && childTraceSpans.length > 0) {
        failure.childTraceSpans = childTraceSpans
      }
      return failure as Record<string, any>
    }

    // childResult is an ExecutionResult with structure { success, output, metadata, logs }
    // We want the actual output from the execution
    const result = childResult.output || {}

    return {
      success: true,
      childWorkflowName,
      result,
      childTraceSpans: childTraceSpans || [],
    } as Record<string, any>
  }
}
