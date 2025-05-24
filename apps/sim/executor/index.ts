import { createLogger } from '@/lib/logs/console-logger'
import type { BlockOutput } from '@/blocks/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import { useExecutionStore } from '@/stores/execution/store'
import { useConsoleStore } from '@/stores/panel/console/store'
import { useGeneralStore } from '@/stores/settings/general/store'
import {
  AgentBlockHandler,
  ApiBlockHandler,
  ConditionBlockHandler,
  EvaluatorBlockHandler,
  FunctionBlockHandler,
  GenericBlockHandler,
  RouterBlockHandler,
} from './handlers/index'
import { LoopManager } from './loops'
import { PathTracker } from './path'
import { InputResolver } from './resolver'
import type {
  BlockHandler,
  BlockLog,
  ExecutionContext,
  ExecutionResult,
  NormalizedBlockOutput,
  StreamingExecution,
} from './types'

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
    this.resolver = new InputResolver(
      this.actualWorkflow,
      this.environmentVariables,
      this.workflowVariables,
      this.loopManager
    )
    this.pathTracker = new PathTracker(this.actualWorkflow)

    this.blockHandlers = [
      new AgentBlockHandler(),
      new RouterBlockHandler(this.pathTracker),
      new ConditionBlockHandler(this.pathTracker, this.resolver),
      new EvaluatorBlockHandler(),
      new FunctionBlockHandler(),
      new ApiBlockHandler(),
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
    let finalOutput: NormalizedBlockOutput = { response: {} }

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

            // Check if we got a StreamingExecution response from any block
            const streamingOutput = outputs.find(
              (output) =>
                typeof output === 'object' &&
                output !== null &&
                'stream' in output &&
                'execution' in output
            )

            if (streamingOutput) {
              // This is a combined response with both stream and execution data
              logger.info('Found combined stream+execution response from block')

              // Incorporate the execution data from the block into our context
              const executionData = streamingOutput.execution

              // Add any logs from the execution data to our context
              if (executionData.logs && Array.isArray(executionData.logs)) {
                context.blockLogs.push(...executionData.logs)
              }

              // Add proper console entry for the streaming block
              // This ensures identical formatting between streamed and non-streamed outputs
              if (executionData.output) {
                const blockLog = executionData.logs?.find(
                  (log: BlockLog) => log.blockId === executionData.blockId
                )
                const consoleStore = useConsoleStore.getState()

                // Create a complete console entry with the full output structure, not the raw streaming object
                const consoleEntry = {
                  output: executionData.output, // Use just the output, not the whole streaming structure
                  durationMs: blockLog?.durationMs || executionData.metadata?.duration || 0,
                  startedAt:
                    blockLog?.startedAt ||
                    executionData.metadata?.startTime ||
                    new Date().toISOString(),
                  endedAt:
                    blockLog?.endedAt ||
                    executionData.metadata?.endTime ||
                    new Date().toISOString(),
                  workflowId: context.workflowId,
                  timestamp:
                    blockLog?.startedAt ||
                    executionData.metadata?.startTime ||
                    new Date().toISOString(),
                  blockId: executionData.blockId,
                  blockName: executionData.blockName || blockLog?.blockName || 'Agent Block',
                  blockType: executionData.blockType || blockLog?.blockType || 'agent',
                }

                // Add to console
                const newEntry = consoleStore.addConsole(consoleEntry)

                // Save the entryId for potential updates when stream completes
                const consoleEntryId = newEntry?.id

                // Set up a stream completion handler to update the console with final content
                if (consoleEntryId && 'stream' in streamingOutput) {
                  // Clone the stream so we don't consume the original one
                  const originalStream = streamingOutput.stream
                  const [contentStream, returnStream] = originalStream.tee()

                  // Replace the original stream with our cloned version that will be returned
                  streamingOutput.stream = returnStream

                  // Create a reader to process the cloned stream for content collection
                  const reader = contentStream.getReader()
                  const decoder = new TextDecoder()
                  let fullContent = ''

                  // Process the stream in the background to collect the full content

                  ;(async () => {
                    try {
                      while (true) {
                        const { done, value } = await reader.read()
                        if (done) break
                        const chunk = decoder.decode(value, { stream: true })
                        fullContent += chunk
                      }
                      // Once stream is complete, update the console entry with the final content
                      if (fullContent.length > 0 && executionData.output?.response) {
                        const updatedOutput = {
                          ...executionData.output,
                          response: {
                            ...executionData.output.response,
                            content: fullContent,
                          },
                        }

                        // Update the console UI with the final content
                        consoleStore.updateConsole(consoleEntryId, { output: updatedOutput })

                        // Update the execution data itself with the final content
                        // so that when logs are persisted, they have the complete content
                        executionData.output.response.content = fullContent

                        // If there's a block log for this execution, update it with the final content
                        if (executionData.blockId) {
                          const blockLog = context.blockLogs.find(
                            (log) => log.blockId === executionData.blockId
                          )
                          if (blockLog?.output?.response) {
                            blockLog.output.response.content = fullContent
                          }
                        }
                      }

                      // After the stream has fully completed and we've updated the
                      // final content, resume workflow execution for any
                      // downstream blocks (e.g. memory blocks) that depend on
                      // the agent response.
                      try {
                        // Determine the next blocks that are now unblocked.
                        let nextLayer = this.getNextExecutionLayer(context)

                        while (nextLayer.length > 0) {
                          await this.executeLayer(nextLayer, context)

                          // Handle any loop activations, etc.
                          await this.loopManager.processLoopIterations(context)

                          // Fetch the subsequent layer (if any)
                          nextLayer = this.getNextExecutionLayer(context)
                        }
                      } catch (resumeError) {
                        logger.error(
                          'Error continuing workflow after stream completion:',
                          resumeError
                        )
                      }
                    } catch (e) {
                      logger.error('Error processing stream for console update:', e)
                    }
                  })()
                }
              }

              // Build a complete execution result with our context's logs
              const execution: ExecutionResult & { isStreaming: boolean } = {
                success: executionData.success !== false,
                output: executionData.output || { response: {} },
                error: executionData.error,
                logs: context.blockLogs,
                metadata: {
                  duration: Date.now() - startTime.getTime(),
                  startTime: context.metadata.startTime!,
                  endTime: new Date().toISOString(),
                  workflowConnections: this.actualWorkflow.connections.map((conn: any) => ({
                    source: conn.source,
                    target: conn.target,
                  })),
                },
                isStreaming: true,
              }

              // Add block metadata to logs if missing
              if (context.blockLogs.length > 0) {
                for (const log of context.blockLogs) {
                  if (!log.output) log.output = { response: {} }

                  // For blocks matching the streaming block, ensure we add response and content properly
                  if (log.blockId === executionData.blockId) {
                    if (!log.output.response) log.output.response = {}

                    // Add the output structure, preferring direct response content if available
                    if (executionData.output?.response) {
                      // Copy all properties from executionData response
                      Object.assign(log.output.response, executionData.output.response)

                      // For streaming, we may not have content yet, so we store a placeholder
                      // that will be updated when the stream completes
                      if (!log.output.response.content && executionData.output.response.content) {
                        log.output.response.content = executionData.output.response.content
                      }
                    }
                  }
                }
              }

              // Return a properly formed StreamingExecution object
              return {
                stream: streamingOutput.stream,
                execution,
              }
            }

            if (outputs.length > 0) {
              // Filter out StreamingExecution objects (already handled above)
              const normalizedOutputs = outputs.filter(
                (output) =>
                  !(
                    typeof output === 'object' &&
                    output !== null &&
                    'stream' in output &&
                    'execution' in output
                  )
              )
              if (normalizedOutputs.length > 0) {
                finalOutput = normalizedOutputs[
                  normalizedOutputs.length - 1
                ] as NormalizedBlockOutput
              }
            }

            // Process loop iterations - this will activate external paths when loops complete
            await this.loopManager.processLoopIterations(context)

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
    let finalOutput: NormalizedBlockOutput = { response: {} }

    try {
      // Execute the current layer - using the original context, not a clone
      const outputs = await this.executeLayer(blockIds, context)

      if (outputs.length > 0) {
        finalOutput = outputs[outputs.length - 1]
      }
      await this.loopManager.processLoopIterations(context)
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
      (block) => block.metadata?.id === 'starter'
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
      (block) => block.metadata?.id === 'starter'
    )
    if (starterBlock) {
      // Initialize the starter block with the workflow input
      try {
        const _blockParams = starterBlock.config.params
        /* Commenting out input format handling
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
              const inputValue = this.workflowInput?.input?.[field.name] !== undefined 
                ? this.workflowInput.input[field.name]  // Try to get from input.field
                : this.workflowInput?.[field.name]     // Fallback to direct field access
              
              logger.info(`[Executor] Processing input field ${field.name} (${field.type}):`, 
                inputValue !== undefined ? JSON.stringify(inputValue) : 'undefined')

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
          const rawInputData = this.workflowInput?.input !== undefined
            ? this.workflowInput.input  // Use the nested input data
            : this.workflowInput       // Fallback to direct input
          
          // Use the structured input if we processed fields, otherwise use raw input
          const finalInput = hasProcessedFields ? structuredInput : rawInputData
          
          // Initialize the starter block with structured input
          // Ensure both input and direct fields are available
          const starterOutput = {
            response: {
              input: finalInput,
              ...finalInput, // Add input fields directly at response level too
            },
          }
          
          logger.info(`[Executor] Starter output:`, JSON.stringify(starterOutput, null, 2))

          context.blockStates.set(starterBlock.id, {
            output: starterOutput,
            executed: true,
            executionTime: 0,
          })
        } else {
        */
        // Handle structured input (like API calls or chat messages)
        if (this.workflowInput && typeof this.workflowInput === 'object') {
          // Preserve complete workflowInput structure to maintain JSON format
          // when referenced through <start.response.input>
          const starterOutput = {
            response: {
              input: this.workflowInput,
              // Add top-level fields for backward compatibility
              message: this.workflowInput.input,
              conversationId: this.workflowInput.conversationId,
            },
          }

          context.blockStates.set(starterBlock.id, {
            output: starterOutput,
            executed: true,
            executionTime: 0,
          })
        } else {
          // Fallback for primitive input values
          const starterOutput = {
            response: {
              input: this.workflowInput,
            },
          }

          context.blockStates.set(starterBlock.id, {
            output: starterOutput,
            executed: true,
            executionTime: 0,
          })
        }
        //} // End of inputFormat conditional
      } catch (e) {
        logger.warn('Error processing starter block input format:', e)

        // Error handler fallback - preserve structure for both direct access and backward compatibility
        const starterOutput = {
          response: {
            input: this.workflowInput,
            message: this.workflowInput?.input,
            conversationId: this.workflowInput?.conversationId,
          },
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
   *
   * @param context - Current execution context
   * @returns Array of block IDs that are ready to be executed
   */
  private getNextExecutionLayer(context: ExecutionContext): string[] {
    const executedBlocks = context.executedBlocks
    const pendingBlocks = new Set<string>()

    for (const block of this.actualWorkflow.blocks) {
      if (executedBlocks.has(block.id) || block.enabled === false) {
        continue
      }

      // Only consider blocks in the active execution path
      if (!context.activeExecutionPath.has(block.id)) {
        continue
      }

      const incomingConnections = this.actualWorkflow.connections.filter(
        (conn) => conn.target === block.id
      )

      // Find all loops that this block is a part of
      const containingLoops = Object.values(this.actualWorkflow.loops || {}).filter((loop) =>
        loop.nodes.includes(block.id)
      )

      const isInLoop = containingLoops.length > 0

      if (isInLoop) {
        // Check if this block is part of a self-loop (single-node loop)
        const isInSelfLoop = containingLoops.some(
          (loop) => loop.nodes.length === 1 && loop.nodes[0] === block.id
        )

        // Check if there's a direct self-connection
        const hasSelfConnection = this.actualWorkflow.connections.some(
          (conn) => conn.source === block.id && conn.target === block.id
        )

        if (isInSelfLoop || hasSelfConnection) {
          // For self-loops, we only need the node to be in the active execution path
          // It will be reset after each iteration by the loop manager
          pendingBlocks.add(block.id)
          continue
        }

        // For regular multi-node loops
        const hasValidPath = incomingConnections.some((conn) => {
          return executedBlocks.has(conn.source)
        })

        if (hasValidPath) {
          pendingBlocks.add(block.id)
        }
      } else {
        // Regular non-loop block handling (unchanged)
        const allDependenciesMet = incomingConnections.every((conn) => {
          const sourceExecuted = executedBlocks.has(conn.source)
          const sourceBlock = this.actualWorkflow.blocks.find((b) => b.id === conn.source)
          const sourceBlockState = context.blockStates.get(conn.source)
          const hasSourceError =
            sourceBlockState?.output?.error !== undefined ||
            sourceBlockState?.output?.response?.error !== undefined

          // For condition blocks, check if this is the selected path
          if (conn.sourceHandle?.startsWith('condition-')) {
            const sourceBlock = this.actualWorkflow.blocks.find((b) => b.id === conn.source)
            if (sourceBlock?.metadata?.id === 'condition') {
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
          if (sourceBlock?.metadata?.id === 'router') {
            const selectedTarget = context.decisions.router.get(conn.source)

            // If source is executed and this is not the selected target, consider it met
            if (sourceExecuted && selectedTarget && conn.target !== selectedTarget) {
              return true
            }

            // Otherwise, this dependency is met only if source is executed and this is the selected target
            return sourceExecuted && conn.target === selectedTarget
          }

          // For error connections, check if the source had an error
          if (conn.sourceHandle === 'error') {
            return sourceExecuted && hasSourceError
          }

          // For regular connections, check if the source was executed without error
          if (conn.sourceHandle === 'source' || !conn.sourceHandle) {
            return sourceExecuted && !hasSourceError
          }

          // If source is not in active path, consider this dependency met
          // This allows blocks with multiple inputs to execute even if some inputs are from inactive paths
          if (!context.activeExecutionPath.has(conn.source)) {
            return true
          }

          // For regular blocks, dependency is met if source is executed
          return sourceExecuted
        })

        if (allDependenciesMet) {
          pendingBlocks.add(block.id)
        }
      }
    }

    return Array.from(pendingBlocks)
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
  ): Promise<NormalizedBlockOutput[]> {
    const { setActiveBlocks } = useExecutionStore.getState()

    try {
      // Set all blocks in this layer as active
      useExecutionStore.setState({ activeBlockIds: new Set(blockIds) })

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
      useExecutionStore.setState({ activeBlockIds: new Set() })
      throw error
    }
  }

  /**
   * Executes a single block with error handling and logging.
   *
   * @param blockId - ID of the block to execute
   * @param context - Current execution context
   * @returns Normalized block output
   * @throws Error if block execution fails
   */
  private async executeBlock(
    blockId: string,
    context: ExecutionContext
  ): Promise<NormalizedBlockOutput> {
    const block = this.actualWorkflow.blocks.find((b) => b.id === blockId)
    if (!block) {
      throw new Error(`Block ${blockId} not found`)
    }

    // Special case for starter block - it's already been initialized in createExecutionContext
    // This ensures we don't re-execute the starter block and just return its existing state
    if (block.metadata?.id === 'starter') {
      const starterState = context.blockStates.get(blockId)
      if (starterState) {
        return starterState.output as NormalizedBlockOutput
      }
    }

    const blockLog = this.createBlockLog(block)
    const addConsole = useConsoleStore.getState().addConsole
    const { setActiveBlocks } = useExecutionStore.getState()

    try {
      if (block.enabled === false) {
        throw new Error(`Cannot execute disabled block: ${block.metadata?.name || block.id}`)
      }

      // Check if this block needs the starter block's output
      // This is especially relevant for API, function, and conditions that might reference <start.response.input>
      const starterBlock = this.actualWorkflow.blocks.find((b) => b.metadata?.id === 'starter')
      if (starterBlock) {
        const starterState = context.blockStates.get(starterBlock.id)
        if (!starterState) {
          logger.warn(
            `Starter block state not found when executing ${block.metadata?.name || blockId}. This may cause reference errors.`
          )
        }
      }

      // Resolve inputs (which will look up references to other blocks including starter)
      const inputs = this.resolver.resolveInputs(block, context)

      // Store input data in the block log
      blockLog.input = inputs

      // Track block execution start
      trackWorkflowTelemetry('block_execution_start', {
        workflowId: context.workflowId,
        blockId: block.id,
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
        return { activeBlockIds: updatedActiveBlockIds }
      })

      // Normalize the output
      const output = this.normalizeBlockOutput(rawOutput, block)

      // Update the context with the execution result
      context.blockStates.set(blockId, {
        output,
        executed: true,
        executionTime,
      })

      // Update the execution log
      blockLog.success = true
      blockLog.output = output
      blockLog.durationMs = Math.round(executionTime)
      blockLog.endedAt = new Date().toISOString()

      context.blockLogs.push(blockLog)
      addConsole({
        output: blockLog.output,
        durationMs: blockLog.durationMs,
        startedAt: blockLog.startedAt,
        endedAt: blockLog.endedAt,
        workflowId: context.workflowId,
        blockId: block.id,
        blockName: block.metadata?.name || 'Unnamed Block',
        blockType: block.metadata?.id || 'unknown',
      })

      trackWorkflowTelemetry('block_execution', {
        workflowId: context.workflowId,
        blockId: block.id,
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
      addConsole({
        output: {},
        error:
          error.message ||
          `Error executing ${block.metadata?.id || 'unknown'} block: ${String(error)}`,
        durationMs: blockLog.durationMs,
        startedAt: blockLog.startedAt,
        endedAt: blockLog.endedAt,
        workflowId: context.workflowId,
        blockName: block.metadata?.name || 'Unnamed Block',
        blockType: block.metadata?.id || 'unknown',
      })

      // Check for error connections and follow them if they exist
      const hasErrorPath = this.activateErrorPath(blockId, context)

      // Log the error for visibility
      logger.error(
        `Error executing block ${block.metadata?.name || blockId}:`,
        this.sanitizeError(error)
      )

      // Create error output with appropriate structure
      const errorOutput: NormalizedBlockOutput = {
        response: {
          error: this.extractErrorMessage(error),
          status: error.status || 500,
        },
        error: this.extractErrorMessage(error),
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
    if (block?.metadata?.id === 'starter' || block?.metadata?.id === 'condition') {
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
   * Normalizes a block output to ensure it has the expected structure.
   * Handles different block types with appropriate response formats.
   *
   * @param output - Raw output from block execution
   * @param block - Block that produced the output
   * @returns Normalized output with consistent structure
   */
  private normalizeBlockOutput(output: any, block: SerializedBlock): NormalizedBlockOutput {
    // Handle error outputs
    if (output && typeof output === 'object' && output.error) {
      return {
        response: {
          error: output.error,
          status: output.status || 500,
        },
        error: output.error,
      }
    }

    if (output && typeof output === 'object' && 'response' in output) {
      // If response already contains an error, maintain it
      if (output.response?.error) {
        return {
          ...output,
          error: output.response.error,
        }
      }
      return output as NormalizedBlockOutput
    }

    const blockType = block.metadata?.id

    if (blockType === 'agent') {
      return output
    }

    if (blockType === 'router') {
      return {
        response: {
          content: '',
          model: '',
          tokens: { prompt: 0, completion: 0, total: 0 },
          selectedPath: output?.selectedPath || {
            blockId: '',
            blockType: '',
            blockTitle: '',
          },
        },
      }
    }

    if (blockType === 'condition') {
      if (output && typeof output === 'object' && 'response' in output) {
        return {
          response: {
            ...output.response,
            conditionResult: output.response.conditionResult || false,
            selectedPath: output.response.selectedPath || {
              blockId: '',
              blockType: '',
              blockTitle: '',
            },
            selectedConditionId: output.response.selectedConditionId || '',
          },
        }
      }

      return {
        response: {
          conditionResult: output?.conditionResult || false,
          selectedPath: output?.selectedPath || {
            blockId: '',
            blockType: '',
            blockTitle: '',
          },
          selectedConditionId: output?.selectedConditionId || '',
        },
      }
    }

    if (blockType === 'function') {
      return {
        response: {
          result: output?.result,
          stdout: output?.stdout || '',
        },
      }
    }

    if (blockType === 'api') {
      return {
        response: {
          data: output?.data,
          status: output?.status || 0,
          headers: output?.headers || {},
        },
      }
    }

    if (blockType === 'evaluator') {
      const evaluatorResponse: {
        content: string
        model: string
        [key: string]: any
      } = {
        content: output?.content || '',
        model: output?.model || '',
      }

      if (output && typeof output === 'object') {
        Object.keys(output).forEach((key) => {
          if (key !== 'content' && key !== 'model') {
            evaluatorResponse[key] = output[key]
          }
        })
      }

      return { response: evaluatorResponse }
    }

    return {
      response: { result: output },
    }
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
