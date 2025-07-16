import { BlockPathCalculator } from '@/lib/block-path-calculator'
import { createLogger } from '@/lib/logs/console-logger'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/consts'
import {
  AgentBlockHandler,
  ApiBlockHandler,
  ConditionBlockHandler,
  EvaluatorBlockHandler,
  FunctionBlockHandler,
  GenericBlockHandler,
  LoopBlockHandler,
  ParallelBlockHandler,
  ResponseBlockHandler,
  RouterBlockHandler,
  WorkflowBlockHandler,
} from '@/executor/handlers'
import { LoopManager } from '@/executor/loops/loops'
import { ParallelManager } from '@/executor/parallels/parallels'
import { PathTracker } from '@/executor/path/path'
import { InputResolver } from '@/executor/resolver/resolver'
import type {
  BlockHandler,
  BlockLog,
  ExecutionContext,
  ExecutionResult,
  NormalizedBlockOutput,
  StreamingExecution,
} from '@/executor/types'
import { streamingResponseFormatProcessor } from '@/executor/utils'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import { useExecutionStore } from '@/stores/execution/store'
import { useConsoleStore } from '@/stores/panel/console/store'
import { useGeneralStore } from '@/stores/settings/general/store'

const logger = createLogger('Executor')

/**
 * Tracks telemetry events for workflow execution if telemetry is enabled
 */
function trackWorkflowTelemetry(eventName: string, data: Record<string, any>) {
  if (typeof window !== 'undefined' && window.__SIM_TRACK_EVENT) {
    // Add timestamp and sanitize the data to avoid circular references
    const safeData = {
      ...data,
      timestamp: Date.now(),
    }

    // Track the event through the global telemetry function
    window.__SIM_TRACK_EVENT(eventName, {
      category: 'workflow',
      ...safeData,
    })
  }
}

/**
 * Core execution engine that runs workflow blocks in topological order.
 *
 * Handles block execution, state management, and error handling.
 */
export class Executor {
  // Core components are initialized once and remain immutable
  private resolver: InputResolver
  private loopManager: LoopManager
  private parallelManager: ParallelManager
  private pathTracker: PathTracker
  private blockHandlers: BlockHandler[]
  private workflowInput: any
  private isDebugging = false
  private contextExtensions: any = {}
  private actualWorkflow: SerializedWorkflow

  constructor(
    private workflowParam:
      | SerializedWorkflow
      | {
          workflow: SerializedWorkflow
          currentBlockStates?: Record<string, BlockOutput>
          envVarValues?: Record<string, string>
          workflowInput?: any
          workflowVariables?: Record<string, any>
          contextExtensions?: {
            stream?: boolean
            selectedOutputIds?: string[]
            edges?: Array<{ source: string; target: string }>
            onStream?: (streamingExecution: StreamingExecution) => Promise<void>
            executionId?: string
          }
        },
    private initialBlockStates: Record<string, BlockOutput> = {},
    private environmentVariables: Record<string, string> = {},
    workflowInput?: any,
    private workflowVariables: Record<string, any> = {}
  ) {
    // Handle new constructor format with options object
    if (typeof workflowParam === 'object' && 'workflow' in workflowParam) {
      const options = workflowParam
      this.actualWorkflow = options.workflow
      this.initialBlockStates = options.currentBlockStates || {}
      this.environmentVariables = options.envVarValues || {}
      this.workflowInput = options.workflowInput || {}
      this.workflowVariables = options.workflowVariables || {}

      // Store context extensions for streaming and output selection
      if (options.contextExtensions) {
        this.contextExtensions = options.contextExtensions

        if (this.contextExtensions.stream) {
          logger.info('Executor initialized with streaming enabled', {
            hasSelectedOutputIds: Array.isArray(this.contextExtensions.selectedOutputIds),
            selectedOutputCount: Array.isArray(this.contextExtensions.selectedOutputIds)
              ? this.contextExtensions.selectedOutputIds.length
              : 0,
            selectedOutputIds: this.contextExtensions.selectedOutputIds || [],
          })
        }
      }
    } else {
      this.actualWorkflow = workflowParam

      if (workflowInput) {
        this.workflowInput = workflowInput
        logger.info('[Executor] Using workflow input:', JSON.stringify(this.workflowInput, null, 2))
      } else {
        this.workflowInput = {}
      }
    }

    this.validateWorkflow()

    this.loopManager = new LoopManager(this.actualWorkflow.loops || {})
    this.parallelManager = new ParallelManager(this.actualWorkflow.parallels || {})

    // Calculate accessible blocks for consistent reference resolution
    const accessibleBlocksMap = BlockPathCalculator.calculateAccessibleBlocksForWorkflow(
      this.actualWorkflow
    )

    this.resolver = new InputResolver(
      this.actualWorkflow,
      this.environmentVariables,
      this.workflowVariables,
      this.loopManager,
      accessibleBlocksMap
    )
    this.pathTracker = new PathTracker(this.actualWorkflow)

    this.blockHandlers = [
      new AgentBlockHandler(),
      new RouterBlockHandler(this.pathTracker),
      new ConditionBlockHandler(this.pathTracker, this.resolver),
      new EvaluatorBlockHandler(),
      new FunctionBlockHandler(),
      new ApiBlockHandler(),
      new LoopBlockHandler(this.resolver, this.pathTracker),
      new ParallelBlockHandler(this.resolver, this.pathTracker),
      new ResponseBlockHandler(),
      new WorkflowBlockHandler(),
      new GenericBlockHandler(),
    ]

    this.isDebugging = useGeneralStore.getState().isDebugModeEnabled
  }

  /**
   * Executes the workflow and returns the result.
   *
   * @param workflowId - Unique identifier for the workflow execution
   * @returns Execution result containing output, logs, and metadata, or a stream, or combined execution and stream
   */
  async execute(workflowId: string): Promise<ExecutionResult | StreamingExecution> {
    const { setIsExecuting, setIsDebugging, setPendingBlocks, reset } = useExecutionStore.getState()
    const startTime = new Date()
    let finalOutput: NormalizedBlockOutput = {}

    // Track workflow execution start
    trackWorkflowTelemetry('workflow_execution_started', {
      workflowId,
      blockCount: this.actualWorkflow.blocks.length,
      connectionCount: this.actualWorkflow.connections.length,
      startTime: startTime.toISOString(),
    })

    this.validateWorkflow()

    const context = this.createExecutionContext(workflowId, startTime)

    try {
      setIsExecuting(true)

      if (this.isDebugging) {
        setIsDebugging(true)
      }

      let hasMoreLayers = true
      let iteration = 0
      const maxIterations = 100 // Safety limit for infinite loops

      while (hasMoreLayers && iteration < maxIterations) {
        const nextLayer = this.getNextExecutionLayer(context)

        if (this.isDebugging) {
          // In debug mode, update the pending blocks and wait for user interaction
          setPendingBlocks(nextLayer)

          // If there are no more blocks, we're done
          if (nextLayer.length === 0) {
            hasMoreLayers = false
          } else {
            // Return early to wait for manual stepping
            // The caller (useWorkflowExecution) will handle resumption
            return {
              success: true,
              output: finalOutput,
              metadata: {
                duration: Date.now() - startTime.getTime(),
                startTime: context.metadata.startTime!,
                pendingBlocks: nextLayer,
                isDebugSession: true,
                context: context, // Include context for resumption
                workflowConnections: this.actualWorkflow.connections.map((conn: any) => ({
                  source: conn.source,
                  target: conn.target,
                })),
              },
              logs: context.blockLogs,
            }
          }
        } else {
          // Normal execution without debug mode
          if (nextLayer.length === 0) {
            hasMoreLayers = false
          } else {
            const outputs = await this.executeLayer(nextLayer, context)

            for (const output of outputs) {
              if (
                output &&
                typeof output === 'object' &&
                'stream' in output &&
                'execution' in output
              ) {
                if (context.onStream) {
                  const streamingExec = output as StreamingExecution
                  const [streamForClient, streamForExecutor] = streamingExec.stream.tee()

                  // Apply response format processing to the client stream if needed
                  const blockId = (streamingExec.execution as any).blockId

                  // Get response format from initial block states (passed from useWorkflowExecution)
                  // The initialBlockStates contain the subblock values including responseFormat
                  let responseFormat: any
                  if (this.initialBlockStates?.[blockId]) {
                    const blockState = this.initialBlockStates[blockId] as any
                    responseFormat = blockState.responseFormat
                  }

                  const processedClientStream = streamingResponseFormatProcessor.processStream(
                    streamForClient,
                    blockId,
                    context.selectedOutputIds || [],
                    responseFormat
                  )

                  const clientStreamingExec = { ...streamingExec, stream: processedClientStream }

                  try {
                    // Handle client stream with proper error handling
                    await context.onStream(clientStreamingExec)
                  } catch (streamError: any) {
                    logger.error('Error in onStream callback:', streamError)
                    // Continue execution even if stream callback fails
                  }

                  // Process executor stream with proper cleanup
                  const reader = streamForExecutor.getReader()
                  const decoder = new TextDecoder()
                  let fullContent = ''

                  try {
                    while (true) {
                      const { done, value } = await reader.read()
                      if (done) break
                      fullContent += decoder.decode(value, { stream: true })
                    }

                    const blockId = (streamingExec.execution as any).blockId
                    const blockState = context.blockStates.get(blockId)
                    if (blockState?.output) {
                      // Check if we have response format - if so, preserve structured response
                      let responseFormat: any
                      if (this.initialBlockStates?.[blockId]) {
                        const initialBlockState = this.initialBlockStates[blockId] as any
                        responseFormat = initialBlockState.responseFormat
                      }

                      if (responseFormat && fullContent) {
                        // For structured responses, always try to parse the raw streaming content
                        // The streamForExecutor contains the raw JSON response, not the processed display text
                        try {
                          const parsedContent = JSON.parse(fullContent)
                          // Preserve metadata but spread parsed fields at root level (same as manual execution)
                          const structuredOutput = {
                            ...parsedContent,
                            tokens: blockState.output.tokens,
                            toolCalls: blockState.output.toolCalls,
                            providerTiming: blockState.output.providerTiming,
                            cost: blockState.output.cost,
                          }
                          blockState.output = structuredOutput

                          // Also update the corresponding block log with the structured output
                          const blockLog = context.blockLogs.find((log) => log.blockId === blockId)
                          if (blockLog) {
                            blockLog.output = structuredOutput
                          }
                        } catch (parseError) {
                          // If parsing fails, fall back to setting content
                          blockState.output.content = fullContent
                        }
                      } else {
                        // No response format, use standard content setting
                        blockState.output.content = fullContent
                      }
                    }
                  } catch (readerError: any) {
                    logger.error('Error reading stream for executor:', readerError)
                    // Set partial content if available
                    const blockId = (streamingExec.execution as any).blockId
                    const blockState = context.blockStates.get(blockId)
                    if (blockState?.output && fullContent) {
                      // Check if we have response format for error handling too
                      let responseFormat: any
                      if (this.initialBlockStates?.[blockId]) {
                        const initialBlockState = this.initialBlockStates[blockId] as any
                        responseFormat = initialBlockState.responseFormat
                      }

                      if (responseFormat) {
                        // For structured responses, always try to parse the raw streaming content
                        // The streamForExecutor contains the raw JSON response, not the processed display text
                        try {
                          const parsedContent = JSON.parse(fullContent)
                          const structuredOutput = {
                            ...parsedContent,
                            tokens: blockState.output.tokens,
                            toolCalls: blockState.output.toolCalls,
                            providerTiming: blockState.output.providerTiming,
                            cost: blockState.output.cost,
                          }
                          blockState.output = structuredOutput

                          // Also update the corresponding block log with the structured output
                          const blockLog = context.blockLogs.find((log) => log.blockId === blockId)
                          if (blockLog) {
                            blockLog.output = structuredOutput
                          }
                        } catch (parseError) {
                          // If parsing fails, fall back to setting content
                          blockState.output.content = fullContent
                        }
                      } else {
                        // No response format, use standard content setting
                        blockState.output.content = fullContent
                      }
                    }
                  } finally {
                    try {
                      reader.releaseLock()
                    } catch (releaseError: any) {
                      // Reader might already be released
                      logger.debug('Reader already released:', releaseError)
                    }
                  }
                }
              }
            }

            const normalizedOutputs = outputs
              .filter(
                (output) =>
                  !(
                    typeof output === 'object' &&
                    output !== null &&
                    'stream' in output &&
                    'execution' in output
                  )
              )
              .map((output) => output as NormalizedBlockOutput)

            if (normalizedOutputs.length > 0) {
              finalOutput = normalizedOutputs[normalizedOutputs.length - 1]
            }
            // Process loop iterations - this will activate external paths when loops complete
            await this.loopManager.processLoopIterations(context)

            // Process parallel iterations - similar to loops but conceptually for parallel execution
            await this.parallelManager.processParallelIterations(context)

            // Continue execution for any newly activated paths
            // Only stop execution if there are no more blocks to execute
            const updatedNextLayer = this.getNextExecutionLayer(context)
            if (updatedNextLayer.length === 0) {
              hasMoreLayers = false
            }
          }
        }

        iteration++
      }

      const endTime = new Date()
      context.metadata.endTime = endTime.toISOString()
      const duration = endTime.getTime() - startTime.getTime()

      trackWorkflowTelemetry('workflow_execution_completed', {
        workflowId,
        duration,
        blockCount: this.actualWorkflow.blocks.length,
        executedBlockCount: context.executedBlocks.size,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        success: true,
      })

      return {
        success: true,
        output: finalOutput,
        metadata: {
          duration: duration,
          startTime: context.metadata.startTime!,
          endTime: context.metadata.endTime!,
          workflowConnections: this.actualWorkflow.connections.map((conn: any) => ({
            source: conn.source,
            target: conn.target,
          })),
        },
        logs: context.blockLogs,
      }
    } catch (error: any) {
      logger.error('Workflow execution failed:', this.sanitizeError(error))

      // Track workflow execution failure
      trackWorkflowTelemetry('workflow_execution_failed', {
        workflowId,
        duration: Date.now() - startTime.getTime(),
        error: this.extractErrorMessage(error),
        executedBlockCount: context.executedBlocks.size,
        blockLogs: context.blockLogs.length,
      })

      return {
        success: false,
        output: finalOutput,
        error: this.extractErrorMessage(error),
        logs: context.blockLogs,
      }
    } finally {
      if (!this.isDebugging) {
        reset()
      }
    }
  }

  /**
   * Continues execution in debug mode from the current state.
   *
   * @param blockIds - Block IDs to execute in this step
   * @param context - The current execution context
   * @returns Updated execution result
   */
  async continueExecution(blockIds: string[], context: ExecutionContext): Promise<ExecutionResult> {
    const { setPendingBlocks } = useExecutionStore.getState()
    let finalOutput: NormalizedBlockOutput = {}

    try {
      // Execute the current layer - using the original context, not a clone
      const outputs = await this.executeLayer(blockIds, context)

      if (outputs.length > 0) {
        const nonStreamingOutputs = outputs.filter(
          (o) => !(o && typeof o === 'object' && 'stream' in o)
        ) as NormalizedBlockOutput[]
        if (nonStreamingOutputs.length > 0) {
          finalOutput = nonStreamingOutputs[nonStreamingOutputs.length - 1]
        }
      }
      await this.loopManager.processLoopIterations(context)
      await this.parallelManager.processParallelIterations(context)
      const nextLayer = this.getNextExecutionLayer(context)
      setPendingBlocks(nextLayer)

      // Check if we've completed execution
      const isComplete = nextLayer.length === 0

      if (isComplete) {
        const endTime = new Date()
        context.metadata.endTime = endTime.toISOString()

        return {
          success: true,
          output: finalOutput,
          metadata: {
            duration: endTime.getTime() - new Date(context.metadata.startTime!).getTime(),
            startTime: context.metadata.startTime!,
            endTime: context.metadata.endTime!,
            pendingBlocks: [],
            isDebugSession: false,
            workflowConnections: this.actualWorkflow.connections.map((conn) => ({
              source: conn.source,
              target: conn.target,
            })),
          },
          logs: context.blockLogs,
        }
      }

      // Return the updated state for the next step
      return {
        success: true,
        output: finalOutput,
        metadata: {
          duration: Date.now() - new Date(context.metadata.startTime!).getTime(),
          startTime: context.metadata.startTime!,
          pendingBlocks: nextLayer,
          isDebugSession: true,
          context: context, // Return the same context object for continuity
        },
        logs: context.blockLogs,
      }
    } catch (error: any) {
      logger.error('Debug step execution failed:', this.sanitizeError(error))

      return {
        success: false,
        output: finalOutput,
        error: this.extractErrorMessage(error),
        logs: context.blockLogs,
      }
    }
  }

  /**
   * Validates that the workflow meets requirements for execution.
   * Checks for starter block, connections, and loop configurations.
   *
   * @throws Error if workflow validation fails
   */
  private validateWorkflow(): void {
    const starterBlock = this.actualWorkflow.blocks.find(
      (block) => block.metadata?.id === BlockType.STARTER
    )
    if (!starterBlock || !starterBlock.enabled) {
      throw new Error('Workflow must have an enabled starter block')
    }

    const incomingToStarter = this.actualWorkflow.connections.filter(
      (conn) => conn.target === starterBlock.id
    )
    if (incomingToStarter.length > 0) {
      throw new Error('Starter block cannot have incoming connections')
    }

    const outgoingFromStarter = this.actualWorkflow.connections.filter(
      (conn) => conn.source === starterBlock.id
    )
    if (outgoingFromStarter.length === 0) {
      throw new Error('Starter block must have at least one outgoing connection')
    }

    const blockIds = new Set(this.actualWorkflow.blocks.map((block) => block.id))
    for (const conn of this.actualWorkflow.connections) {
      if (!blockIds.has(conn.source)) {
        throw new Error(`Connection references non-existent source block: ${conn.source}`)
      }
      if (!blockIds.has(conn.target)) {
        throw new Error(`Connection references non-existent target block: ${conn.target}`)
      }
    }

    for (const [loopId, loop] of Object.entries(this.actualWorkflow.loops || {})) {
      for (const nodeId of loop.nodes) {
        if (!blockIds.has(nodeId)) {
          throw new Error(`Loop ${loopId} references non-existent block: ${nodeId}`)
        }
      }

      if (loop.iterations <= 0) {
        throw new Error(`Loop ${loopId} must have a positive iterations value`)
      }

      if (loop.loopType === 'forEach') {
        if (
          !loop.forEachItems ||
          (typeof loop.forEachItems === 'string' && loop.forEachItems.trim() === '')
        ) {
          throw new Error(`forEach loop ${loopId} requires a collection to iterate over`)
        }
      }
    }
  }

  /**
   * Creates the initial execution context with predefined states.
   * Sets up the starter block and its connections in the active execution path.
   *
   * @param workflowId - Unique identifier for the workflow execution
   * @param startTime - Execution start time
   * @returns Initialized execution context
   */
  private createExecutionContext(workflowId: string, startTime: Date): ExecutionContext {
    const context: ExecutionContext = {
      workflowId,
      blockStates: new Map(),
      blockLogs: [],
      metadata: {
        startTime: startTime.toISOString(),
        duration: 0, // Initialize with zero, will be updated throughout execution
      },
      environmentVariables: this.environmentVariables,
      decisions: {
        router: new Map(),
        condition: new Map(),
      },
      loopIterations: new Map(),
      loopItems: new Map(),
      completedLoops: new Set(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      workflow: this.actualWorkflow,
      // Add streaming context from contextExtensions
      stream: this.contextExtensions.stream || false,
      selectedOutputIds: this.contextExtensions.selectedOutputIds || [],
      edges: this.contextExtensions.edges || [],
      onStream: this.contextExtensions.onStream,
    }

    Object.entries(this.initialBlockStates).forEach(([blockId, output]) => {
      context.blockStates.set(blockId, {
        output: output as NormalizedBlockOutput,
        executed: true,
        executionTime: 0,
      })
    })

    // Initialize loop iterations
    if (this.actualWorkflow.loops) {
      for (const loopId of Object.keys(this.actualWorkflow.loops)) {
        // Start all loops at iteration 0
        context.loopIterations.set(loopId, 0)
      }
    }

    const starterBlock = this.actualWorkflow.blocks.find(
      (block) => block.metadata?.id === BlockType.STARTER
    )
    if (starterBlock) {
      // Initialize the starter block with the workflow input
      try {
        const blockParams = starterBlock.config.params
        const inputFormat = blockParams?.inputFormat

        // If input format is defined, structure the input according to the schema
        if (inputFormat && Array.isArray(inputFormat) && inputFormat.length > 0) {
          // Create structured input based on input format
          const structuredInput: Record<string, any> = {}

          // Process each field in the input format
          for (const field of inputFormat) {
            if (field.name && field.type) {
              // Get the field value from workflow input if available
              // First try to access via input.field, then directly from field
              // This handles both input formats: { input: { field: value } } and { field: value }
              const inputValue =
                this.workflowInput?.input?.[field.name] !== undefined
                  ? this.workflowInput.input[field.name] // Try to get from input.field
                  : this.workflowInput?.[field.name] // Fallback to direct field access

              logger.info(
                `[Executor] Processing input field ${field.name} (${field.type}):`,
                inputValue !== undefined ? JSON.stringify(inputValue) : 'undefined'
              )

              // Convert the value to the appropriate type
              let typedValue = inputValue
              if (inputValue !== undefined) {
                if (field.type === 'number' && typeof inputValue !== 'number') {
                  typedValue = Number(inputValue)
                } else if (field.type === 'boolean' && typeof inputValue !== 'boolean') {
                  typedValue = inputValue === 'true' || inputValue === true
                } else if (
                  (field.type === 'object' || field.type === 'array') &&
                  typeof inputValue === 'string'
                ) {
                  try {
                    typedValue = JSON.parse(inputValue)
                  } catch (e) {
                    logger.warn(`Failed to parse ${field.type} input for field ${field.name}:`, e)
                  }
                }
              }

              // Add the field to structured input
              structuredInput[field.name] = typedValue
            }
          }

          // Check if we managed to process any fields - if not, use the raw input
          const hasProcessedFields = Object.keys(structuredInput).length > 0

          // If no fields matched the input format, extract the raw input to use instead
          const rawInputData =
            this.workflowInput?.input !== undefined
              ? this.workflowInput.input // Use the input value
              : this.workflowInput // Fallback to direct input

          // Use the structured input if we processed fields, otherwise use raw input
          const finalInput = hasProcessedFields ? structuredInput : rawInputData

          // Initialize the starter block with structured input (flattened)
          const starterOutput = {
            input: finalInput,
            conversationId: this.workflowInput?.conversationId, // Add conversationId to root
            ...finalInput, // Add input fields directly at top level
          }

          logger.info(`[Executor] Starter output:`, JSON.stringify(starterOutput, null, 2))

          context.blockStates.set(starterBlock.id, {
            output: starterOutput,
            executed: true,
            executionTime: 0,
          })
        } else {
          // Handle structured input (like API calls or chat messages)
          if (this.workflowInput && typeof this.workflowInput === 'object') {
            // Check if this is a chat workflow input (has both input and conversationId)
            if (
              Object.hasOwn(this.workflowInput, 'input') &&
              Object.hasOwn(this.workflowInput, 'conversationId')
            ) {
              // Chat workflow: extract input and conversationId to root level
              const starterOutput = {
                input: this.workflowInput.input,
                conversationId: this.workflowInput.conversationId,
              }

              context.blockStates.set(starterBlock.id, {
                output: starterOutput,
                executed: true,
                executionTime: 0,
              })
            } else {
              // API workflow: spread the raw data directly (no wrapping)
              const starterOutput = { ...this.workflowInput }

              context.blockStates.set(starterBlock.id, {
                output: starterOutput,
                executed: true,
                executionTime: 0,
              })
            }
          } else {
            // Fallback for primitive input values
            const starterOutput = {
              input: this.workflowInput,
            }

            context.blockStates.set(starterBlock.id, {
              output: starterOutput,
              executed: true,
              executionTime: 0,
            })
          }
        }
      } catch (e) {
        logger.warn('Error processing starter block input format:', e)

        // Error handler fallback - use appropriate structure
        let starterOutput: any
        if (this.workflowInput && typeof this.workflowInput === 'object') {
          // Check if this is a chat workflow input (has both input and conversationId)
          if (
            Object.hasOwn(this.workflowInput, 'input') &&
            Object.hasOwn(this.workflowInput, 'conversationId')
          ) {
            // Chat workflow: extract input and conversationId to root level
            starterOutput = {
              input: this.workflowInput.input,
              conversationId: this.workflowInput.conversationId,
            }
          } else {
            // API workflow: spread the raw data directly (no wrapping)
            starterOutput = { ...this.workflowInput }
          }
        } else {
          // Primitive input
          starterOutput = {
            input: this.workflowInput,
          }
        }

        logger.info('[Executor] Fallback starter output:', JSON.stringify(starterOutput, null, 2))

        context.blockStates.set(starterBlock.id, {
          output: starterOutput,
          executed: true,
          executionTime: 0,
        })
      }
      // Ensure the starter block is in the active execution path
      context.activeExecutionPath.add(starterBlock.id)
      // Mark the starter block as executed
      context.executedBlocks.add(starterBlock.id)

      // Add all blocks connected to the starter to the active execution path
      const connectedToStarter = this.actualWorkflow.connections
        .filter((conn) => conn.source === starterBlock.id)
        .map((conn) => conn.target)

      connectedToStarter.forEach((blockId) => {
        context.activeExecutionPath.add(blockId)
      })
    }

    return context
  }

  /**
   * Determines the next layer of blocks to execute based on dependencies and execution path.
   * Handles special cases for blocks in loops, condition blocks, and router blocks.
   * For blocks inside parallel executions, creates multiple virtual instances.
   *
   * @param context - Current execution context
   * @returns Array of block IDs that are ready to be executed
   */
  private getNextExecutionLayer(context: ExecutionContext): string[] {
    const executedBlocks = context.executedBlocks
    const pendingBlocks = new Set<string>()

    // Check if we have any active parallel executions
    const activeParallels = new Map<string, any>()
    if (context.parallelExecutions) {
      for (const [parallelId, state] of context.parallelExecutions) {
        if (
          state.currentIteration > 0 &&
          state.currentIteration <= state.parallelCount &&
          !context.completedLoops.has(parallelId)
        ) {
          activeParallels.set(parallelId, state)
        }
      }
    }

    for (const block of this.actualWorkflow.blocks) {
      if (executedBlocks.has(block.id) || block.enabled === false) {
        continue
      }

      // Check if this block is inside an active parallel
      let insideParallel: string | null = null
      for (const [parallelId, parallel] of Object.entries(this.actualWorkflow.parallels || {})) {
        if (parallel.nodes.includes(block.id)) {
          insideParallel = parallelId
          break
        }
      }

      // If block is inside a parallel, handle multiple instances
      if (insideParallel && activeParallels.has(insideParallel)) {
        const parallelState = activeParallels.get(insideParallel)

        // Create virtual instances for each unprocessed iteration
        const virtualBlockIds = this.parallelManager.createVirtualBlockInstances(
          block,
          insideParallel,
          parallelState,
          executedBlocks,
          context.activeExecutionPath
        )

        for (const virtualBlockId of virtualBlockIds) {
          // Check dependencies for this virtual instance
          const incomingConnections = this.actualWorkflow.connections.filter(
            (conn) => conn.target === block.id
          )

          const iterationIndex = Number.parseInt(virtualBlockId.split('_iteration_')[1])
          const allDependenciesMet = this.checkDependencies(
            incomingConnections,
            executedBlocks,
            context,
            insideParallel,
            iterationIndex
          )

          if (allDependenciesMet) {
            pendingBlocks.add(virtualBlockId)

            // Store mapping for virtual block
            if (!context.parallelBlockMapping) {
              context.parallelBlockMapping = new Map()
            }
            context.parallelBlockMapping.set(virtualBlockId, {
              originalBlockId: block.id,
              parallelId: insideParallel,
              iterationIndex: iterationIndex,
            })
          }
        }
      } else if (insideParallel) {
        // Block is inside a parallel but the parallel is not active
        // Check if all virtual instances have been executed
        const parallelState = context.parallelExecutions?.get(insideParallel)
        if (parallelState) {
          let allVirtualInstancesExecuted = true
          for (let i = 0; i < parallelState.parallelCount; i++) {
            const virtualBlockId = `${block.id}_parallel_${insideParallel}_iteration_${i}`
            if (!executedBlocks.has(virtualBlockId)) {
              allVirtualInstancesExecuted = false
              break
            }
          }

          // If all virtual instances have been executed, skip this block
          // It should not be executed as a regular block
          if (allVirtualInstancesExecuted) {
            continue
          }
        }

        // If we reach here, the parallel hasn't been initialized yet
        // Allow normal execution flow
        if (!context.activeExecutionPath.has(block.id)) {
          continue
        }

        const incomingConnections = this.actualWorkflow.connections.filter(
          (conn) => conn.target === block.id
        )

        const allDependenciesMet = this.checkDependencies(
          incomingConnections,
          executedBlocks,
          context
        )

        if (allDependenciesMet) {
          pendingBlocks.add(block.id)
        }
      } else {
        // Regular block handling (not inside a parallel)
        // Only consider blocks in the active execution path
        if (!context.activeExecutionPath.has(block.id)) {
          continue
        }

        const incomingConnections = this.actualWorkflow.connections.filter(
          (conn) => conn.target === block.id
        )

        const allDependenciesMet = this.checkDependencies(
          incomingConnections,
          executedBlocks,
          context
        )

        if (allDependenciesMet) {
          pendingBlocks.add(block.id)
        }
      }
    }

    return Array.from(pendingBlocks)
  }

  /**
   * Checks if all dependencies for a block are met.
   * Handles special cases for different connection types.
   *
   * @param incomingConnections - Connections coming into the block
   * @param executedBlocks - Set of executed block IDs
   * @param context - Execution context
   * @param insideParallel - ID of parallel block if this block is inside one
   * @param iterationIndex - Index of the parallel iteration if applicable
   * @returns Whether all dependencies are met
   */
  private checkDependencies(
    incomingConnections: any[],
    executedBlocks: Set<string>,
    context: ExecutionContext,
    insideParallel?: string,
    iterationIndex?: number
  ): boolean {
    if (incomingConnections.length === 0) {
      return true
    }
    // Check if this is a loop block
    const isLoopBlock = incomingConnections.some((conn) => {
      const sourceBlock = this.actualWorkflow.blocks.find((b) => b.id === conn.source)
      return sourceBlock?.metadata?.id === BlockType.LOOP
    })

    if (isLoopBlock) {
      // Loop blocks are treated as regular blocks with standard dependency checking
      return incomingConnections.every((conn) => {
        const sourceExecuted = executedBlocks.has(conn.source)
        const sourceBlockState = context.blockStates.get(conn.source)
        const hasSourceError = sourceBlockState?.output?.error !== undefined

        // For error connections, check if the source had an error
        if (conn.sourceHandle === 'error') {
          return sourceExecuted && hasSourceError
        }

        // For regular connections, check if the source was executed without error
        if (conn.sourceHandle === 'source' || !conn.sourceHandle) {
          return sourceExecuted && !hasSourceError
        }

        // If source is not in active path, consider this dependency met
        if (!context.activeExecutionPath.has(conn.source)) {
          return true
        }

        // For regular blocks, dependency is met if source is executed
        return sourceExecuted
      })
    }
    // Regular non-loop block handling
    return incomingConnections.every((conn) => {
      // For virtual blocks inside parallels, check the source appropriately
      let sourceId = conn.source
      if (insideParallel !== undefined && iterationIndex !== undefined) {
        // If the source is also inside the same parallel, use virtual ID
        const sourceBlock = this.actualWorkflow.blocks.find((b) => b.id === conn.source)
        if (
          sourceBlock &&
          this.actualWorkflow.parallels?.[insideParallel]?.nodes.includes(conn.source)
        ) {
          sourceId = `${conn.source}_parallel_${insideParallel}_iteration_${iterationIndex}`
        }
      }

      const sourceExecuted = executedBlocks.has(sourceId)
      const sourceBlock = this.actualWorkflow.blocks.find((b) => b.id === conn.source)
      const sourceBlockState =
        context.blockStates.get(sourceId) || context.blockStates.get(conn.source)
      const hasSourceError = sourceBlockState?.output?.error !== undefined

      // Special handling for loop-start-source connections
      if (conn.sourceHandle === 'loop-start-source') {
        // This block is connected to a loop's start output
        // It should be activated when the loop block executes
        return sourceExecuted
      }

      // Special handling for loop-end-source connections
      if (conn.sourceHandle === 'loop-end-source') {
        // This block is connected to a loop's end output
        // It should only be activated when the loop completes
        const loopCompleted = context.completedLoops.has(conn.source)
        return loopCompleted
      }

      // Special handling for parallel-start-source connections
      if (conn.sourceHandle === 'parallel-start-source') {
        // This block is connected to a parallel's start output
        // It should be activated when the parallel block executes
        return executedBlocks.has(conn.source)
      }

      // Special handling for parallel-end-source connections
      if (conn.sourceHandle === 'parallel-end-source') {
        // This block is connected to a parallel's end output
        // It should only be activated when the parallel completes
        const parallelCompleted = context.completedLoops.has(conn.source)
        return parallelCompleted
      }

      // For condition blocks, check if this is the selected path
      if (conn.sourceHandle?.startsWith('condition-')) {
        const sourceBlock = this.actualWorkflow.blocks.find((b) => b.id === conn.source)
        if (sourceBlock?.metadata?.id === BlockType.CONDITION) {
          const conditionId = conn.sourceHandle.replace('condition-', '')
          const selectedCondition = context.decisions.condition.get(conn.source)

          // If source is executed and this is not the selected path, consider it met
          if (sourceExecuted && selectedCondition && conditionId !== selectedCondition) {
            return true
          }

          // Otherwise, this dependency is met only if source is executed and this is the selected path
          return sourceExecuted && conditionId === selectedCondition
        }
      }

      // For router blocks, check if this is the selected target
      if (sourceBlock?.metadata?.id === BlockType.ROUTER) {
        const selectedTarget = context.decisions.router.get(conn.source)

        // If source is executed and this is not the selected target, consider it met
        if (sourceExecuted && selectedTarget && conn.target !== selectedTarget) {
          return true
        }

        // Otherwise, this dependency is met only if source is executed and this is the selected target
        return sourceExecuted && conn.target === selectedTarget
      }

      // If source is not in active path, consider this dependency met
      // This allows blocks with multiple inputs to execute even if some inputs are from inactive paths
      if (!context.activeExecutionPath.has(conn.source)) {
        return true
      }

      // For error connections, check if the source had an error
      if (conn.sourceHandle === 'error') {
        return sourceExecuted && hasSourceError
      }

      // For regular connections, check if the source was executed without error
      if (conn.sourceHandle === 'source' || !conn.sourceHandle) {
        return sourceExecuted && !hasSourceError
      }

      // For regular blocks, dependency is met if source is executed
      return sourceExecuted
    })
  }

  /**
   * Executes a layer of blocks in parallel.
   * Updates execution paths based on router and condition decisions.
   *
   * @param blockIds - IDs of blocks to execute
   * @param context - Current execution context
   * @returns Array of block outputs
   */
  private async executeLayer(
    blockIds: string[],
    context: ExecutionContext
  ): Promise<(NormalizedBlockOutput | StreamingExecution)[]> {
    const { setActiveBlocks } = useExecutionStore.getState()

    try {
      // Set all blocks in this layer as active
      const activeBlockIds = new Set(blockIds)

      // For virtual block IDs (parallel execution), also add the actual block ID so it appears as executing as well in the UI
      blockIds.forEach((blockId) => {
        if (context.parallelBlockMapping?.has(blockId)) {
          const parallelInfo = context.parallelBlockMapping.get(blockId)
          if (parallelInfo) {
            activeBlockIds.add(parallelInfo.originalBlockId)
          }
        }
      })

      setActiveBlocks(activeBlockIds)

      const results = await Promise.all(
        blockIds.map((blockId) => this.executeBlock(blockId, context))
      )

      blockIds.forEach((blockId) => {
        context.executedBlocks.add(blockId)
      })

      this.pathTracker.updateExecutionPaths(blockIds, context)

      return results
    } catch (error) {
      // If there's an uncaught error, clear all active blocks as a safety measure
      setActiveBlocks(new Set())
      throw error
    }
  }

  /**
   * Executes a single block with error handling and logging.
   * Handles virtual block IDs for parallel iterations.
   *
   * @param blockId - ID of the block to execute (may be a virtual ID)
   * @param context - Current execution context
   * @returns Normalized block output
   * @throws Error if block execution fails
   */
  private async executeBlock(
    blockId: string,
    context: ExecutionContext
  ): Promise<NormalizedBlockOutput | StreamingExecution> {
    // Check if this is a virtual block ID for parallel execution
    let actualBlockId = blockId
    let parallelInfo:
      | { originalBlockId: string; parallelId: string; iterationIndex: number }
      | undefined

    if (context.parallelBlockMapping?.has(blockId)) {
      parallelInfo = context.parallelBlockMapping.get(blockId)
      actualBlockId = parallelInfo!.originalBlockId

      // Set the current virtual block ID in context so resolver can access it
      context.currentVirtualBlockId = blockId

      // Set up iteration-specific context BEFORE resolving inputs
      if (parallelInfo) {
        this.parallelManager.setupIterationContext(context, parallelInfo)
      }
    } else {
      // Clear currentVirtualBlockId for non-virtual blocks
      context.currentVirtualBlockId = undefined
    }

    const block = this.actualWorkflow.blocks.find((b) => b.id === actualBlockId)
    if (!block) {
      throw new Error(`Block ${actualBlockId} not found`)
    }

    // Special case for starter block - it's already been initialized in createExecutionContext
    // This ensures we don't re-execute the starter block and just return its existing state
    if (block.metadata?.id === BlockType.STARTER) {
      const starterState = context.blockStates.get(actualBlockId)
      if (starterState) {
        return starterState.output as NormalizedBlockOutput
      }
    }

    const blockLog = this.createBlockLog(block)
    // Use virtual block ID in logs if applicable
    if (parallelInfo) {
      blockLog.blockId = blockId
      blockLog.blockName = `${block.metadata?.name || ''} (iteration ${parallelInfo.iterationIndex + 1})`
    }

    const addConsole = useConsoleStore.getState().addConsole
    const { setActiveBlocks } = useExecutionStore.getState()

    try {
      if (block.enabled === false) {
        throw new Error(`Cannot execute disabled block: ${block.metadata?.name || block.id}`)
      }

      // Check if this block needs the starter block's output
      // This is especially relevant for API, function, and conditions that might reference <start.input>
      const starterBlock = this.actualWorkflow.blocks.find(
        (b) => b.metadata?.id === BlockType.STARTER
      )
      if (starterBlock) {
        const starterState = context.blockStates.get(starterBlock.id)
        if (!starterState) {
          logger.warn(
            `Starter block state not found when executing ${block.metadata?.name || actualBlockId}. This may cause reference errors.`
          )
        }
      }

      // Store raw input configuration first for error debugging
      blockLog.input = block.config.params

      // Resolve inputs (which will look up references to other blocks including starter)
      const inputs = this.resolver.resolveInputs(block, context)

      // Store input data in the block log
      blockLog.input = inputs

      // Track block execution start
      trackWorkflowTelemetry('block_execution_start', {
        workflowId: context.workflowId,
        blockId: block.id,
        virtualBlockId: parallelInfo ? blockId : undefined,
        iterationIndex: parallelInfo?.iterationIndex,
        blockType: block.metadata?.id || 'unknown',
        blockName: block.metadata?.name || 'Unnamed Block',
        inputSize: Object.keys(inputs).length,
        startTime: new Date().toISOString(),
      })

      // Find the appropriate handler
      const handler = this.blockHandlers.find((h) => h.canHandle(block))
      if (!handler) {
        throw new Error(`No handler found for block type: ${block.metadata?.id}`)
      }

      // Execute the block
      const startTime = performance.now()
      const rawOutput = await handler.execute(block, inputs, context)
      const executionTime = performance.now() - startTime

      // Remove this block from active blocks immediately after execution
      // This ensures the pulse effect stops as soon as the block completes
      useExecutionStore.setState((state) => {
        const updatedActiveBlockIds = new Set(state.activeBlockIds)
        updatedActiveBlockIds.delete(blockId)

        // For virtual blocks, also check if we should remove the actual block ID
        if (parallelInfo) {
          // Check if there are any other virtual blocks for the same actual block still active
          const hasOtherVirtualBlocks = Array.from(state.activeBlockIds).some((activeId) => {
            if (activeId === blockId) return false // Skip the current block we're removing
            const mapping = context.parallelBlockMapping?.get(activeId)
            return mapping && mapping.originalBlockId === parallelInfo.originalBlockId
          })

          // If no other virtual blocks are active for this actual block, remove the actual block ID too
          if (!hasOtherVirtualBlocks) {
            updatedActiveBlockIds.delete(parallelInfo.originalBlockId)
          }
        }

        return { activeBlockIds: updatedActiveBlockIds }
      })

      if (
        rawOutput &&
        typeof rawOutput === 'object' &&
        'stream' in rawOutput &&
        'execution' in rawOutput
      ) {
        const streamingExec = rawOutput as StreamingExecution
        const output = (streamingExec.execution as any).output as NormalizedBlockOutput

        context.blockStates.set(blockId, {
          output,
          executed: true,
          executionTime,
        })

        // Also store under the actual block ID for reference
        if (parallelInfo) {
          // Store iteration result in parallel state
          this.parallelManager.storeIterationResult(
            context,
            parallelInfo.parallelId,
            parallelInfo.iterationIndex,
            output
          )
        }

        // Update the execution log
        blockLog.success = true
        blockLog.output = output
        blockLog.durationMs = Math.round(executionTime)
        blockLog.endedAt = new Date().toISOString()

        context.blockLogs.push(blockLog)

        // Skip console logging for infrastructure blocks like loops and parallels
        // For streaming blocks, we'll add the console entry after stream processing
        if (block.metadata?.id !== BlockType.LOOP && block.metadata?.id !== BlockType.PARALLEL) {
          addConsole({
            input: blockLog.input,
            output: blockLog.output,
            success: true,
            durationMs: blockLog.durationMs,
            startedAt: blockLog.startedAt,
            endedAt: blockLog.endedAt,
            workflowId: context.workflowId,
            blockId: parallelInfo ? blockId : block.id,
            executionId: this.contextExtensions.executionId,
            blockName: parallelInfo
              ? `${block.metadata?.name || 'Unnamed Block'} (iteration ${
                  parallelInfo.iterationIndex + 1
                })`
              : block.metadata?.name || 'Unnamed Block',
            blockType: block.metadata?.id || 'unknown',
          })
        }

        trackWorkflowTelemetry('block_execution', {
          workflowId: context.workflowId,
          blockId: block.id,
          virtualBlockId: parallelInfo ? blockId : undefined,
          iterationIndex: parallelInfo?.iterationIndex,
          blockType: block.metadata?.id || 'unknown',
          blockName: block.metadata?.name || 'Unnamed Block',
          durationMs: Math.round(executionTime),
          success: true,
        })

        return streamingExec
      }

      // Handle error outputs and ensure object structure
      const output: NormalizedBlockOutput =
        rawOutput && typeof rawOutput === 'object' && rawOutput.error
          ? { error: rawOutput.error, status: rawOutput.status || 500 }
          : typeof rawOutput === 'object' && rawOutput !== null
            ? rawOutput
            : { result: rawOutput }

      // Update the context with the execution result
      // Use virtual block ID for parallel executions
      context.blockStates.set(blockId, {
        output,
        executed: true,
        executionTime,
      })

      // Also store under the actual block ID for reference
      if (parallelInfo) {
        // Store iteration result in parallel state
        this.parallelManager.storeIterationResult(
          context,
          parallelInfo.parallelId,
          parallelInfo.iterationIndex,
          output
        )
      }

      // Update the execution log
      blockLog.success = true
      blockLog.output = output
      blockLog.durationMs = Math.round(executionTime)
      blockLog.endedAt = new Date().toISOString()

      context.blockLogs.push(blockLog)

      // Skip console logging for infrastructure blocks like loops and parallels
      if (block.metadata?.id !== BlockType.LOOP && block.metadata?.id !== BlockType.PARALLEL) {
        addConsole({
          input: blockLog.input,
          output: blockLog.output,
          success: true,
          durationMs: blockLog.durationMs,
          startedAt: blockLog.startedAt,
          endedAt: blockLog.endedAt,
          workflowId: context.workflowId,
          blockId: parallelInfo ? blockId : block.id,
          executionId: this.contextExtensions.executionId,
          blockName: parallelInfo
            ? `${block.metadata?.name || 'Unnamed Block'} (iteration ${
                parallelInfo.iterationIndex + 1
              })`
            : block.metadata?.name || 'Unnamed Block',
          blockType: block.metadata?.id || 'unknown',
        })
      }

      trackWorkflowTelemetry('block_execution', {
        workflowId: context.workflowId,
        blockId: block.id,
        virtualBlockId: parallelInfo ? blockId : undefined,
        iterationIndex: parallelInfo?.iterationIndex,
        blockType: block.metadata?.id || 'unknown',
        blockName: block.metadata?.name || 'Unnamed Block',
        durationMs: Math.round(executionTime),
        success: true,
      })

      return output
    } catch (error: any) {
      // Remove this block from active blocks if there's an error
      useExecutionStore.setState((state) => {
        const updatedActiveBlockIds = new Set(state.activeBlockIds)
        updatedActiveBlockIds.delete(blockId)

        // For virtual blocks, also check if we should remove the actual block ID
        if (parallelInfo) {
          // Check if there are any other virtual blocks for the same actual block still active
          const hasOtherVirtualBlocks = Array.from(state.activeBlockIds).some((activeId) => {
            if (activeId === blockId) return false // Skip the current block we're removing
            const mapping = context.parallelBlockMapping?.get(activeId)
            return mapping && mapping.originalBlockId === parallelInfo.originalBlockId
          })

          // If no other virtual blocks are active for this actual block, remove the actual block ID too
          if (!hasOtherVirtualBlocks) {
            updatedActiveBlockIds.delete(parallelInfo.originalBlockId)
          }
        }

        return { activeBlockIds: updatedActiveBlockIds }
      })

      blockLog.success = false
      blockLog.error =
        error.message ||
        `Error executing ${block.metadata?.id || 'unknown'} block: ${String(error)}`
      blockLog.endedAt = new Date().toISOString()
      blockLog.durationMs =
        new Date(blockLog.endedAt).getTime() - new Date(blockLog.startedAt).getTime()

      // Log the error even if we'll continue execution through error path
      context.blockLogs.push(blockLog)

      // Skip console logging for infrastructure blocks like loops and parallels
      if (block.metadata?.id !== BlockType.LOOP && block.metadata?.id !== BlockType.PARALLEL) {
        addConsole({
          input: blockLog.input,
          output: {},
          success: false,
          error:
            error.message ||
            `Error executing ${block.metadata?.id || 'unknown'} block: ${String(error)}`,
          durationMs: blockLog.durationMs,
          startedAt: blockLog.startedAt,
          endedAt: blockLog.endedAt,
          workflowId: context.workflowId,
          blockId: parallelInfo ? blockId : block.id,
          executionId: this.contextExtensions.executionId,
          blockName: parallelInfo
            ? `${block.metadata?.name || 'Unnamed Block'} (iteration ${parallelInfo.iterationIndex + 1})`
            : block.metadata?.name || 'Unnamed Block',
          blockType: block.metadata?.id || 'unknown',
        })
      }

      // Check for error connections and follow them if they exist
      const hasErrorPath = this.activateErrorPath(actualBlockId, context)

      // Log the error for visibility
      logger.error(
        `Error executing block ${block.metadata?.name || actualBlockId}:`,
        this.sanitizeError(error)
      )

      // Create error output with appropriate structure
      const errorOutput: NormalizedBlockOutput = {
        error: this.extractErrorMessage(error),
        status: error.status || 500,
      }

      // Set block state with error output
      context.blockStates.set(blockId, {
        output: errorOutput,
        executed: true,
        executionTime: blockLog.durationMs,
      })

      // If there are error paths to follow, return error output instead of throwing
      if (hasErrorPath) {
        // Return the error output to allow execution to continue along error path
        return errorOutput
      }

      // Create a proper error message that is never undefined
      let errorMessage = error.message

      // Handle the specific "undefined (undefined)" case
      if (!errorMessage || errorMessage === 'undefined (undefined)') {
        errorMessage = `Error executing ${block.metadata?.id || 'unknown'} block: ${block.metadata?.name || 'Unnamed Block'}`

        // Try to get more details if possible
        if (error && typeof error === 'object') {
          if (error.code) errorMessage += ` (code: ${error.code})`
          if (error.status) errorMessage += ` (status: ${error.status})`
          if (error.type) errorMessage += ` (type: ${error.type})`
        }
      }

      trackWorkflowTelemetry('block_execution_error', {
        workflowId: context.workflowId,
        blockId: block.id,
        virtualBlockId: parallelInfo ? blockId : undefined,
        iterationIndex: parallelInfo?.iterationIndex,
        blockType: block.metadata?.id || 'unknown',
        blockName: block.metadata?.name || 'Unnamed Block',
        durationMs: blockLog.durationMs,
        errorType: error.name || 'Error',
        errorMessage: this.extractErrorMessage(error),
      })

      throw new Error(errorMessage)
    }
  }

  /**
   * Activates error paths from a block that had an error.
   * Checks for connections from the block's "error" handle and adds them to the active execution path.
   *
   * @param blockId - ID of the block that had an error
   * @param context - Current execution context
   * @returns Whether there was an error path to follow
   */
  private activateErrorPath(blockId: string, context: ExecutionContext): boolean {
    // Skip for starter blocks which don't have error handles
    const block = this.actualWorkflow.blocks.find((b) => b.id === blockId)
    if (
      block?.metadata?.id === BlockType.STARTER ||
      block?.metadata?.id === BlockType.CONDITION ||
      block?.metadata?.id === BlockType.LOOP ||
      block?.metadata?.id === BlockType.PARALLEL
    ) {
      return false
    }

    // Look for connections from this block's error handle
    const errorConnections = this.actualWorkflow.connections.filter(
      (conn) => conn.source === blockId && conn.sourceHandle === 'error'
    )

    if (errorConnections.length === 0) {
      return false
    }

    // Add all error connection targets to the active execution path
    for (const conn of errorConnections) {
      context.activeExecutionPath.add(conn.target)
      logger.info(`Activated error path from ${blockId} to ${conn.target}`)
    }

    return true
  }

  /**
   * Creates a new block log entry with initial values.
   *
   * @param block - Block to create log for
   * @returns Initialized block log
   */
  private createBlockLog(block: SerializedBlock): BlockLog {
    return {
      blockId: block.id,
      blockName: block.metadata?.name || '',
      blockType: block.metadata?.id || '',
      startedAt: new Date().toISOString(),
      endedAt: '',
      durationMs: 0,
      success: false,
    }
  }

  /**
   * Extracts a meaningful error message from any error object structure.
   * Handles nested error objects, undefined messages, and various error formats.
   *
   * @param error - The error object to extract a message from
   * @returns A meaningful error message string
   */
  private extractErrorMessage(error: any): string {
    // If it's already a string, return it
    if (typeof error === 'string') {
      return error
    }

    // If it has a message property, use that
    if (error.message) {
      return error.message
    }

    // If it's an object with response data, include that
    if (error.response?.data) {
      const data = error.response.data
      if (typeof data === 'string') {
        return data
      }
      if (data.message) {
        return data.message
      }
      return JSON.stringify(data)
    }

    // If it's an object, stringify it
    if (typeof error === 'object') {
      return JSON.stringify(error)
    }

    // Fallback to string conversion
    return String(error)
  }

  /**
   * Sanitizes an error object for logging purposes.
   * Ensures the error is in a format that won't cause "undefined" to appear in logs.
   *
   * @param error - The error object to sanitize
   * @returns A sanitized version of the error for logging
   */
  private sanitizeError(error: any): any {
    // If it's already a string, return it
    if (typeof error === 'string') {
      return error
    }

    // If it has a message property, return that
    if (error.message) {
      return error.message
    }

    // If it's an object with response data, include that
    if (error.response?.data) {
      const data = error.response.data
      if (typeof data === 'string') {
        return data
      }
      if (data.message) {
        return data.message
      }
      return JSON.stringify(data)
    }

    // If it's an object, stringify it
    if (typeof error === 'object') {
      return JSON.stringify(error)
    }

    // Fallback to string conversion
    return String(error)
  }
}
