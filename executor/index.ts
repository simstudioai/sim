import { useConsoleStore } from '@/stores/console/store'
import { useExecutionStore } from '@/stores/execution/store'
import { getAllBlocks } from '@/blocks'
import { generateRouterPrompt } from '@/blocks/blocks/router'
import { BlockOutput } from '@/blocks/types'
import { BlockConfig } from '@/blocks/types'
import { executeProviderRequest } from '@/providers/service'
import { getProviderFromModel } from '@/providers/utils'
import { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import { executeTool, getTool } from '@/tools'
import { BlockLog, ExecutionContext, ExecutionResult, Tool } from './types'
import { resolveBlockReferences, resolveEnvVariables } from './utils'

/**
 * Main executor class for running agentic workflows.
 * Handles parallel execution, state management, and special block types.
 */
export class Executor {
  private loopIterations: Map<string, number>

  constructor(
    private workflow: SerializedWorkflow,
    private initialBlockStates: Record<string, BlockOutput> = {},
    private environmentVariables: Record<string, string> = {},
    private processedConditionBlocks: Set<string> = new Set<string>()
  ) {
    this.loopIterations = new Map<string, number>()
  }

  /**
   * Main entry point for workflow execution.
   * Initializes context, executes blocks, and returns results.
   *
   * @param workflowId - Unique identifier for the workflow
   * @returns Promise<ExecutionResult> - Execution results including success/failure, output, and logs
   */
  async execute(workflowId: string): Promise<ExecutionResult> {
    const { setIsExecuting, reset } = useExecutionStore.getState()
    const startTime = new Date()

    // Validate that the workflow has a starter block
    const starterBlock = this.workflow.blocks.find((block) => block.metadata?.id === 'starter')
    if (!starterBlock || !starterBlock.enabled) {
      throw new Error('Workflow must have a starter block')
    }

    // Validate that the starter block is an entry point
    const incomingToStarter = this.workflow.connections.filter(
      (conn) => conn.target === starterBlock.id
    )
    if (incomingToStarter.length > 0) {
      throw new Error('Starter block cannot have incoming connections')
    }

    // Validate that the starter block has outgoing connections
    const outgoingFromStarter = this.workflow.connections.filter(
      (conn) => conn.source === starterBlock.id
    )
    if (outgoingFromStarter.length === 0) {
      throw new Error('Starter block must have at least one outgoing connection')
    }

    // Build the execution context: holds outputs, logs, metadata, and environment variables.
    const context: ExecutionContext = {
      workflowId,
      blockStates: new Map<string, BlockOutput>(),
      blockLogs: [],
      metadata: {
        startTime: startTime.toISOString(),
      },
      environmentVariables: this.environmentVariables,
    }

    // Pre-populate context with any initial block states.
    Object.entries(this.initialBlockStates).forEach(([blockId, output]) => {
      context.blockStates.set(blockId, output)
    })

    // Add a dummy output for the starter block so downstream blocks can reference it if needed
    context.blockStates.set(starterBlock.id, { response: { result: true } })

    try {
      setIsExecuting(true)
      // Execute all blocks in parallel layers (using topological sorting).
      const lastOutput = await this.executeInParallel(context)

      const endTime = new Date()
      context.metadata.endTime = endTime.toISOString()

      return {
        success: true,
        output: lastOutput,
        metadata: {
          duration: endTime.getTime() - startTime.getTime(),
          startTime: context.metadata.startTime!,
          endTime: context.metadata.endTime!,
        },
        logs: context.blockLogs,
      }
    } catch (error: any) {
      return {
        success: false,
        output: { response: {} },
        error: error.message || 'Workflow execution failed',
        logs: context.blockLogs,
      }
    } finally {
      reset() // Reset execution state
    }
  }

  /**
   * Executes workflow blocks layer-by-layer in parallel, handling loops and conditional paths.
   *
   * Key Features:
   * - Executes blocks with no dependencies in parallel using topological sorting
   * - Handles special blocks (router, condition) for path decisions
   * - Handles agent and evaluator blocks for structured output
   * - Manages feedback loops with iteration limits
   * - Tracks and updates block states in the execution context
   *
   * @param context - The execution context containing block states and logs
   * @returns Promise<BlockOutput> - The output of the last executed block
   */
  private async executeInParallel(context: ExecutionContext): Promise<BlockOutput> {
    const { blocks, connections } = this.workflow

    this.loopIterations.clear()
    for (const [loopId, loop] of Object.entries(this.workflow.loops || {})) {
      this.loopIterations.set(loopId, 0)
    }

    // Build dependency graphs: inDegree (number of incoming edges) and adjacency (outgoing connections)
    const inDegree = new Map<string, number>()
    const adjacency = new Map<string, string[]>()
    this.processedConditionBlocks = new Set<string>()

    // Initialize maps
    for (const block of blocks) {
      inDegree.set(block.id, 0)
      adjacency.set(block.id, [])
    }

    // Helper functions for identifying entry points and feedback edges
    const isEntryBlock = (blockId: string): boolean => {
      const starterBlock = blocks.find((b) => b.metadata?.id === 'starter')

      // Entry blocks are those that are directly connected to the starter block
      if (starterBlock) {
        const outgoingFromStarter = connections.filter(
          (conn) => conn.source === starterBlock.id && conn.target === blockId
        )
        return outgoingFromStarter.length > 0
      }
      return false
    }

    const isFeedbackEdge = (conn: (typeof connections)[number]): boolean => {
      if (!conn.sourceHandle?.startsWith('condition-')) return false

      const loop = Object.values(this.workflow.loops || {}).find(
        (loop) => loop.nodes.includes(conn.source) && loop.nodes.includes(conn.target)
      )

      if (!loop) return false

      // Get execution order within the loop
      const loopBlocks = loop.nodes
      const sourceIndex = loopBlocks.indexOf(conn.source)
      const targetIndex = loopBlocks.indexOf(conn.target)

      // It's a feedback edge if it points to an earlier block in the loop
      return targetIndex < sourceIndex
    }

    // Set to track which connections are counted in inDegree
    const countedEdges = new Set<(typeof connections)[number]>()

    // Build initial dependency graph
    for (const conn of connections) {
      const sourceBlock = blocks.find((b) => b.id === conn.source)
      const targetBlock = blocks.find((b) => b.id === conn.target)
      let countEdge = true

      if (!sourceBlock || !targetBlock) continue

      if (isFeedbackEdge(conn)) {
        countEdge = false
      }

      // For conditional blocks, only count one incoming edge per source block
      if (conn.sourceHandle?.startsWith('condition-')) {
        // Check if we already counted an edge from this source to this target with a condition handle
        const existingConditionEdge = Array.from(countedEdges).some(
          (edge) =>
            edge.source === conn.source &&
            edge.target === conn.target &&
            edge.sourceHandle?.startsWith('condition-')
        )
        if (existingConditionEdge) {
          countEdge = false
        }
      }

      if (countEdge) {
        inDegree.set(conn.target, (inDegree.get(conn.target) || 0) + 1)
        countedEdges.add(conn)
      }
      adjacency.get(conn.source)?.push(conn.target)
    }

    // Ensure entry blocks have inDegree 0
    for (const block of blocks) {
      if (isEntryBlock(block.id)) {
        inDegree.set(block.id, 0)
      }
    }

    // Maps for tracking routing decisions
    const routerDecisions = new Map<string, string>()
    const activeConditionalPaths = new Map<string, string>()

    // Initial queue: blocks connected to starter
    const queue: string[] = []
    const starterBlock = blocks.find((b) => b.metadata?.id === 'starter')
    if (starterBlock) {
      const outgoingFromStarter = connections
        .filter((conn) => conn.source === starterBlock.id)
        .map((conn) => conn.target)

      for (const targetId of outgoingFromStarter) {
        // Set inDegree to 0 for blocks connected to starter
        inDegree.set(targetId, 0)
        queue.push(targetId)
      }
    }

    let lastOutput: BlockOutput = { response: {} }

    while (queue.length > 0) {
      const currentLayer = [...queue]
      queue.length = 0

      this.processedConditionBlocks.clear()

      // Filter executable blocks
      const executableBlocks = currentLayer.filter((blockId) => {
        const block = blocks.find((b) => b.id === blockId)
        // Skip starter block execution
        if (!block || block.enabled === false || block.metadata?.id === 'starter') return false

        // Check router decisions
        for (const [routerId, chosenPath] of routerDecisions) {
          if (!this.isInChosenPath(blockId, chosenPath, routerId)) return false
        }

        // Check conditional paths
        for (const [conditionBlockId, selectedConditionId] of activeConditionalPaths) {
          const connection = connections.find(
            (conn) =>
              conn.source === conditionBlockId &&
              conn.target === blockId &&
              conn.sourceHandle?.startsWith('condition-')
          )
          if (connection) {
            const connConditionId = connection.sourceHandle?.replace('condition-', '')
            if (connConditionId !== selectedConditionId) return false
          }
        }
        return true
      })

      // Create a Set to track active blocks in the current layer
      const { setActiveBlocks } = useExecutionStore.getState()

      try {
        // Set all blocks in the layer as active before execution
        setActiveBlocks(new Set(executableBlocks))

        // Execute all blocks in the current layer in parallel
        const layerResults = await Promise.all(
          executableBlocks.map(async (blockId) => {
            const block = blocks.find((b) => b.id === blockId)
            if (!block) throw new Error(`Block ${blockId} not found`)

            const inputs = this.resolveInputs(block, context)
            const result = await this.executeBlock(block, inputs, context)
            context.blockStates.set(blockId, result)
            lastOutput = result

            if (block.metadata?.id === 'router') {
              const routerResult = result as {
                response: {
                  content: string
                  model: string
                  tokens: { prompt: number; completion: number; total: number }
                  selectedPath: { blockId: string }
                }
              }
              routerDecisions.set(block.id, routerResult.response.selectedPath.blockId)
            } else if (block.metadata?.id === 'condition') {
              const conditionResult = await this.executeConditionalBlock(block, context)
              activeConditionalPaths.set(
                block.id,
                (conditionResult as any).response.selectedConditionId
              )
            }

            return blockId
          })
        )

        // Process outgoing connections and update queue using the updateInDegree helper
        for (const finishedBlockId of layerResults) {
          const outgoingConns = connections.filter((conn) => conn.source === finishedBlockId)
          for (const conn of outgoingConns) {
            this.updateInDegree(
              conn,
              inDegree,
              queue,
              blocks,
              routerDecisions,
              activeConditionalPaths
            )
          }
        }

        // Check if we need to reset any loops
        for (const [loopId, loop] of Object.entries(this.workflow.loops || {})) {
          const loopBlocks = new Set(loop.nodes)
          const executedLoopBlocks = layerResults.filter((blockId) => loopBlocks.has(blockId))

          if (executedLoopBlocks.length > 0) {
            const iterations = this.loopIterations.get(loopId) || 0

            // Only process if we haven't hit max iterations
            if (iterations < loop.maxIterations) {
              // Check if any block in the loop has outgoing connections to other blocks in the loop
              const hasLoopConnection = executedLoopBlocks.some((blockId) => {
                const outgoingConns = connections.filter((conn) => conn.source === blockId)
                return outgoingConns.some((conn) => loopBlocks.has(conn.target))
              })

              // Check if this was the last block in the loop (e.g., a condition block)
              const isLoopComplete = executedLoopBlocks.some((blockId) => {
                const block = blocks.find((b) => b.id === blockId)
                return block?.metadata?.id === 'condition'
              })

              if (hasLoopConnection && isLoopComplete) {
                this.loopIterations.set(loopId, iterations + 1)
              }
            }
          }
        }
      } finally {
        // Clear active blocks after layer execution
        setActiveBlocks(new Set())
      }
    }

    return lastOutput
  }

  private resetLoopBlocksDegrees(
    loopId: string,
    inDegree: Map<string, number>,
    isFeedbackEdge: (conn: (typeof this.workflow.connections)[number]) => boolean
  ): void {
    const loop = this.workflow.loops?.[loopId]
    if (!loop) return

    for (const blockId of loop.nodes) {
      // For each block in the loop, recalculate its initial inDegree
      let degree = 0
      for (const conn of this.workflow.connections) {
        if (conn.target === blockId && loop.nodes.includes(conn.source)) {
          // Count non-feedback edges within the loop
          if (!isFeedbackEdge(conn)) {
            degree++
          }
        }
      }
      inDegree.set(blockId, degree)
    }
  }

  private shouldResetLoop(loopId: string, blockId: string, chosenPath: string): boolean {
    const loop = this.workflow.loops?.[loopId]
    if (!loop) return false

    const iterations = this.loopIterations.get(loopId) || 0
    const block = this.workflow.blocks.find((b) => b.id === blockId)
    const isConditionBlock = block?.metadata?.id === 'condition'

    // Get execution order within the loop
    const loopBlocks = loop.nodes
    const sourceIndex = loopBlocks.indexOf(blockId)
    const targetIndex = loopBlocks.indexOf(chosenPath)

    // Check if this is a feedback path (points to an earlier block in the loop)
    const isFeedbackPath = targetIndex < sourceIndex

    return isConditionBlock && isFeedbackPath && iterations < loop.maxIterations
  }

  /**
   * Executes a single block with appropriate tool or provider.
   * Handles different block types (router, evaluator, condition, agent).
   *
   * Process:
   * 1. Validates block state and configuration
   * 2. Executes based on block type:
   *    - Router: Makes routing decisions
   *    - Evaluator: Analyzes content and returns metrics
   *    - Condition: Evaluates conditions and selects paths
   *    - Agent: Processes with LLM and optional tools
   * 3. Logs execution details
   * 4. Stores results in context
   *
   * @param block - Block to execute
   * @param inputs - Resolved inputs for the block
   * @param context - Current execution context
   * @returns Promise<BlockOutput> - Block execution results
   */
  private async executeBlock(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    const blockLog = this.startBlockLog(block)
    const addConsole = useConsoleStore.getState().addConsole

    try {
      if (block.enabled === false) {
        throw new Error(`Cannot execute disabled block: ${block.metadata?.name || block.id}`)
      }

      let output: BlockOutput

      // Execute block based on its type.
      if (block.metadata?.id === 'router') {
        output = await this.executeRouterBlock(block, context)
      } else if (block.metadata?.id === 'evaluator') {
        output = await this.executeEvaluatorBlock(block, context)
      } else if (block.metadata?.id === 'condition') {
        output = await this.executeConditionalBlock(block, context)
      } else if (block.metadata?.id === 'agent') {
        // Agent block: use a provider request.
        let responseFormat: any = undefined
        if (inputs.responseFormat) {
          try {
            responseFormat =
              typeof inputs.responseFormat === 'string'
                ? JSON.parse(inputs.responseFormat)
                : inputs.responseFormat
          } catch (error: any) {
            console.error('Error parsing responseFormat:', error)
            throw new Error('Invalid response format: ' + error.message)
          }
        }

        const model = inputs.model || 'gpt-4o'
        const providerId = getProviderFromModel(model)

        // Format tools if provided. (Rename local variable to avoid conflict with imported "tools".)
        const formattedTools = Array.isArray(inputs.tools)
          ? inputs.tools
              .map((tool: any) => {
                const blockFound = getAllBlocks().find((b: BlockConfig) => b.type === tool.type)
                const toolId = blockFound?.tools.access[0]
                if (!toolId) return null

                const toolConfig = getTool(toolId)
                if (!toolConfig) return null

                return {
                  id: toolConfig.id,
                  name: toolConfig.name,
                  description: toolConfig.description,
                  params: tool.params || {},
                  parameters: {
                    type: 'object',
                    properties: Object.entries(toolConfig.params).reduce(
                      (acc, [key, config]) => ({
                        ...acc,
                        [key]: {
                          type: config.type === 'json' ? 'object' : config.type,
                          description: config.description || '',
                          ...(key in tool.params && { default: tool.params[key] }),
                        },
                      }),
                      {}
                    ),
                    required: Object.entries(toolConfig.params)
                      .filter(([_, config]) => config.required)
                      .map(([key]) => key),
                  },
                }
              })
              .filter((t): t is NonNullable<typeof t> => t !== null)
          : []

        const response = await executeProviderRequest(providerId, {
          model,
          systemPrompt: inputs.systemPrompt,
          context:
            Array.isArray(inputs.context) === true
              ? JSON.stringify(inputs.context, null, 2)
              : inputs.context,
          tools: formattedTools.length > 0 ? formattedTools : undefined,
          temperature: inputs.temperature,
          maxTokens: inputs.maxTokens,
          apiKey: inputs.apiKey,
          responseFormat,
        })

        output = responseFormat
          ? {
              ...JSON.parse(response.content),
              tokens: response.tokens || {
                prompt: 0,
                completion: 0,
                total: 0,
              },
              toolCalls: response.toolCalls
                ? {
                    list: response.toolCalls,
                    count: response.toolCalls.length,
                  }
                : undefined,
            }
          : {
              response: {
                content: response.content,
                model: response.model,
                tokens: response.tokens || {
                  prompt: 0,
                  completion: 0,
                  total: 0,
                },
                toolCalls: {
                  list: response.toolCalls || [],
                  count: response.toolCalls?.length || 0,
                },
              },
            }
      } else {
        // Regular tool block execution.
        const tool = getTool(block.config.tool)
        if (!tool) {
          throw new Error(`Tool not found: ${block.config.tool}`)
        }

        const result = await executeTool(block.config.tool, inputs)
        if (!result.success) {
          console.error('Tool execution failed:', result.error)
          throw new Error(result.error || `Tool ${block.config.tool} failed with no error message`)
        }
        output = { response: result.output }
      }

      // Log success
      blockLog.success = true
      blockLog.output = output
      this.finalizeBlockLog(blockLog)
      context.blockLogs.push(blockLog)

      // Add to console immediately
      addConsole({
        output: blockLog.output,
        durationMs: blockLog.durationMs,
        startedAt: blockLog.startedAt,
        endedAt: blockLog.endedAt,
        workflowId: context.workflowId,
        timestamp: blockLog.startedAt,
        blockName: block.metadata?.name || 'Unnamed Block',
        blockType: block.metadata?.id || 'unknown',
      })

      context.blockStates.set(block.id, output)

      return output
    } catch (error: any) {
      // Log error
      blockLog.success = false
      blockLog.error = error.message
      this.finalizeBlockLog(blockLog)
      context.blockLogs.push(blockLog)

      // Add error to console immediately
      addConsole({
        output: {},
        error: error.message,
        durationMs: blockLog.durationMs,
        startedAt: blockLog.startedAt,
        endedAt: blockLog.endedAt,
        workflowId: context.workflowId,
        timestamp: blockLog.startedAt,
        blockName: block.metadata?.name || 'Unnamed Block',
        blockType: block.metadata?.id || 'unknown',
      })

      throw error
    }
  }

  /**
   * Executes a router block to determine the next execution path.
   *
   * Process:
   * 1. Resolves inputs and gets possible target blocks
   * 2. Generates and sends routing prompt to the model
   * 3. Processes response to determine chosen path
   * 4. Validates and returns routing decision
   *
   * @param block - The router block to execute
   * @param context - Current execution context
   * @returns Promise with routing result including chosen path
   */
  private async executeRouterBlock(
    block: SerializedBlock,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    // Resolve inputs for the router block.
    const resolvedInputs = this.resolveInputs(block, context)
    const outgoingConnections = this.workflow.connections.filter((conn) => conn.source === block.id)
    const targetBlocks = outgoingConnections.map((conn) => {
      const targetBlock = this.workflow.blocks.find((b) => b.id === conn.target)
      if (!targetBlock) {
        throw new Error(`Target block ${conn.target} not found`)
      }
      return {
        id: targetBlock.id,
        type: targetBlock.metadata?.id,
        title: targetBlock.metadata?.name,
        description: targetBlock.metadata?.description,
        subBlocks: targetBlock.config.params,
        currentState: context.blockStates.get(targetBlock.id),
      }
    })

    const routerConfig = {
      prompt: resolvedInputs.prompt,
      model: resolvedInputs.model,
      apiKey: resolvedInputs.apiKey,
      temperature: resolvedInputs.temperature || 0,
    }

    const model = routerConfig.model || 'gpt-4o'
    const providerId = getProviderFromModel(model)

    // Generate and send the router prompt.
    const response = await executeProviderRequest(providerId, {
      model: routerConfig.model,
      systemPrompt: generateRouterPrompt(routerConfig.prompt, targetBlocks),
      messages: [{ role: 'user', content: routerConfig.prompt }],
      temperature: routerConfig.temperature,
      apiKey: routerConfig.apiKey,
    })

    const chosenBlockId = response.content.trim().toLowerCase()
    const chosenBlock = targetBlocks.find((b) => b.id === chosenBlockId)
    if (!chosenBlock) {
      throw new Error(`Invalid routing decision: ${chosenBlockId}`)
    }

    const tokens = response.tokens || { prompt: 0, completion: 0, total: 0 }
    return {
      response: {
        content: resolvedInputs.prompt,
        model: response.model,
        tokens: {
          prompt: tokens.prompt || 0,
          completion: tokens.completion || 0,
          total: tokens.total || 0,
        },
        selectedPath: {
          blockId: chosenBlock.id,
          blockType: chosenBlock.type || 'unknown',
          blockTitle: chosenBlock.title || 'Untitled Block',
        },
      },
    } as BlockOutput
  }

  /**
   * Executes an evaluator block which analyzes content against metrics.
   *
   * Process:
   * 1. Resolves inputs including metrics configuration
   * 2. Generates and sends evaluation prompt to the model
   * 3. Processes response to extract metric scores and reasoning
   * 4. Stores evaluation result in context
   *
   * The evaluator block returns structured output with scores and reasoning for each metric,
   * which can be referenced by other blocks (e.g., condition blocks) to make routing decisions.
   *
   * @param block - The evaluator block to execute
   * @param context - Current execution context
   * @returns Promise with evaluation result including metric scores
   */
  private async executeEvaluatorBlock(
    block: SerializedBlock,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    // Resolve inputs for the evaluator block
    const resolvedInputs = this.resolveInputs(block, context)

    const model = resolvedInputs.model || 'gpt-4o'
    const providerId = getProviderFromModel(model)

    // Execute the evaluator prompt with structured output format
    const response = await executeProviderRequest(providerId, {
      model: resolvedInputs.model,
      systemPrompt: resolvedInputs.systemPrompt?.systemPrompt,
      responseFormat: resolvedInputs.systemPrompt?.responseFormat,
      messages: [{ role: 'user', content: resolvedInputs.content }],
      temperature: resolvedInputs.temperature || 0,
      apiKey: resolvedInputs.apiKey,
    })

    // Parse the response content to get metrics
    const parsedContent = JSON.parse(response.content)

    // Create the result in the expected format
    const result = {
      response: {
        content: resolvedInputs.content,
        model: response.model,
        tokens: {
          prompt: response.tokens?.prompt || 0,
          completion: response.tokens?.completion || 0,
          total: response.tokens?.total || 0,
        },
        // Also add each metric as a direct field for easy access
        ...Object.fromEntries(
          Object.entries(parsedContent).map(([key, value]) => [key.toLowerCase(), value])
        ),
      },
    }

    // Store the result in block states
    context.blockStates.set(block.id, result)
    return result
  }

  /**
   * Determines if a block is reachable along the chosen path from a decision block.
   *
   * Uses breadth-first search to:
   * 1. Start from the chosen block
   * 2. Follow valid connections
   * 3. Skip paths from other routers/evaluators
   * 4. Check if target block is reachable
   *
   * @param blockId - ID of block to check
   * @param chosenBlockId - ID of the chosen target block
   * @param decisionBlockId - ID of the router/evaluator making the decision
   * @returns boolean - Whether the block is reachable
   */
  private isInChosenPath(blockId: string, chosenBlockId: string, decisionBlockId: string): boolean {
    const visited = new Set<string>()
    const queue = [chosenBlockId]

    // Add the decision block (router/evaluator) itself as valid
    if (blockId === decisionBlockId) {
      return true
    }

    while (queue.length > 0) {
      const currentId = queue.shift()!
      if (visited.has(currentId)) continue
      visited.add(currentId)

      // If we found the block we're looking for
      if (currentId === blockId) {
        return true
      }

      // Get all outgoing connections from current block
      const connections = this.workflow.connections.filter((conn) => conn.source === currentId)
      for (const conn of connections) {
        // Don't follow connections from other routers
        const sourceBlock = this.workflow.blocks.find((b) => b.id === conn.source)
        if (sourceBlock?.metadata?.id !== 'router') {
          queue.push(conn.target)
        }
      }
    }

    return false
  }

  /**
   * Executes a condition block that evaluates logical conditions and selects a path.
   *
   * Process:
   * 1. Parses and evaluates conditions in order (if/else-if/else)
   * 2. Uses source block's output for evaluation context
   * 3. Selects matching path based on condition result
   * 4. Stores decision in context for downstream execution
   *
   * @param block - The condition block to execute
   * @param context - Current execution context
   * @returns Promise with condition result and selected path
   */
  private async executeConditionalBlock(
    block: SerializedBlock,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    const conditions = JSON.parse(block.config.params.conditions)

    // Identify the source block that feeds into this condition block.
    const sourceBlockId = this.workflow.connections.find((conn) => conn.target === block.id)?.source

    if (!sourceBlockId) {
      throw new Error(`No source block found for condition block ${block.id}`)
    }

    const sourceOutput = context.blockStates.get(sourceBlockId)
    if (!sourceOutput) {
      throw new Error(`No output found for source block ${sourceBlockId}`)
    }

    // Retrieve the source block to derive a dynamic key.
    const sourceBlock = this.workflow.blocks.find((b) => b.id === sourceBlockId)
    if (!sourceBlock) {
      throw new Error(`Source block ${sourceBlockId} not found`)
    }
    const sourceKey = sourceBlock.metadata?.name
      ? sourceBlock.metadata.name.toLowerCase().replace(/\s+/g, '')
      : 'source'

    const outgoingConnections = this.workflow.connections.filter((conn) => conn.source === block.id)

    let conditionMet = false
    let selectedConnection: { target: string; sourceHandle?: string } | null = null
    let selectedCondition: { id: string; title: string; value: string } | null = null

    // Build the evaluation context using the dynamic key
    const evalContext = {
      ...(typeof sourceOutput === 'object' && sourceOutput !== null ? sourceOutput : {}),
      [sourceKey]: sourceOutput,
    }

    // Evaluate conditions one by one.
    for (const condition of conditions) {
      try {
        // Resolve the condition expression using the current context.
        const resolvedCondition = this.resolveInputs(
          {
            id: block.id,
            config: { params: { condition: condition.value }, tool: block.config.tool },
            metadata: block.metadata,
            position: block.position,
            inputs: block.inputs,
            outputs: block.outputs,
            enabled: block.enabled,
          },
          context
        )
        // Evaluate the condition based on the resolved condition string.
        conditionMet = new Function(
          'context',
          `with(context) { return ${resolvedCondition.condition} }`
        )(evalContext)

        // Cast the connection so that TypeScript knows it has a target property.
        const connection = outgoingConnections.find(
          (conn) => conn.sourceHandle === `condition-${condition.id}`
        ) as { target: string; sourceHandle?: string } | undefined

        if (connection) {
          // For if/else-if, require conditionMet to be true.
          // For else, unconditionally select it.
          if ((condition.title === 'if' || condition.title === 'else if') && conditionMet) {
            selectedConnection = connection
            selectedCondition = condition
            break
          } else if (condition.title === 'else') {
            selectedConnection = connection
            selectedCondition = condition
            break
          }
        }
      } catch (error: any) {
        console.error(`Failed to evaluate condition: ${error.message}`, {
          condition,
          error,
        })
        throw new Error(`Failed to evaluate condition: ${error.message}`)
      }
    }

    if (!selectedConnection || !selectedCondition) {
      throw new Error(`No matching path found for condition block ${block.id}`)
    }

    // Identify the target block based on the selected connection.
    const targetBlock = this.workflow.blocks.find((b) => b.id === selectedConnection!.target)
    if (!targetBlock) {
      throw new Error(`Target block ${selectedConnection!.target} not found`)
    }

    // Get the raw output from the source block's state.
    const sourceBlockState = context.blockStates.get(sourceBlockId)
    if (!sourceBlockState) {
      throw new Error(`No state found for source block ${sourceBlockId}`)
    }

    // Return a properly typed BlockOutput with response wrapper
    return {
      response: {
        ...((sourceOutput as any)?.response || {}),
        conditionResult: conditionMet,
        selectedPath: {
          blockId: targetBlock.id,
          blockType: targetBlock.metadata?.id || '',
          blockTitle: targetBlock.metadata?.name || '',
        },
        selectedConditionId: selectedCondition.id,
      },
    } as BlockOutput
  }

  /**
   * Resolves block input values from context and environment.
   * Handles template references and variable substitution.
   *
   * Features:
   * - Resolves block references (<blockId.property>)
   * - Resolves environment variables ({{ENV_VAR}})
   * - Handles special formatting for function blocks
   * - Validates references and paths
   *
   * @param block - Block whose inputs need resolution
   * @param context - Current execution context
   * @returns Record<string, any> - Resolved input values
   */
  private resolveInputs(block: SerializedBlock, context: ExecutionContext): Record<string, any> {
    const inputs = { ...block.config.params }

    const blockById = new Map(this.workflow.blocks.map((b) => [b.id, b]))
    const blockByName = new Map(
      this.workflow.blocks.map((b) => [
        b.metadata?.name ? b.metadata.name.toLowerCase().replace(/\s+/g, '') : b.id,
        b,
      ])
    )

    const resolvedInputs = Object.entries(inputs).reduce(
      (acc, [key, value]) => {
        if (typeof value === 'string') {
          // Resolve block references
          let resolvedValue = resolveBlockReferences(
            value,
            blockById,
            blockByName,
            context.blockStates,
            block.metadata?.name || '',
            block.metadata?.id || '',
            this.workflow.loops
          )

          // Resolve environment variables
          resolvedValue = resolveEnvVariables(resolvedValue, this.environmentVariables)
          try {
            if (resolvedValue.startsWith('{') || resolvedValue.startsWith('[')) {
              acc[key] = JSON.parse(resolvedValue)
            } else {
              acc[key] = resolvedValue
            }
          } catch {
            acc[key] = resolvedValue
          }
        } else {
          acc[key] = resolveEnvVariables(value, this.environmentVariables)
        }
        return acc
      },
      {} as Record<string, any>
    )

    return resolvedInputs
  }

  private startBlockLog(block: SerializedBlock): BlockLog {
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

  private finalizeBlockLog(blockLog: BlockLog): void {
    const endTime = new Date()
    blockLog.endedAt = endTime.toISOString()
    blockLog.durationMs = endTime.getTime() - new Date(blockLog.startedAt).getTime()
  }

  private updateInDegree(
    conn: (typeof this.workflow.connections)[number],
    inDegree: Map<string, number>,
    queue: string[],
    blocks: SerializedBlock[],
    routerDecisions?: Map<string, string>,
    activeConditionalPaths?: Map<string, string>
  ) {
    const sourceBlock = blocks.find((b) => b.id === conn.source)

    if (sourceBlock?.metadata?.id === 'router') {
      const chosenPath = routerDecisions?.get(sourceBlock.id)

      if (conn.target === chosenPath) {
        const newDegree = (inDegree.get(conn.target) || 0) - 1
        inDegree.set(conn.target, newDegree)
        if (newDegree === 0) queue.push(conn.target)
      }
    } else if (conn.sourceHandle?.startsWith('condition-')) {
      const sourceBlockId = conn.source
      const conditionId = conn.sourceHandle.replace('condition-', '')
      const activeCondition = activeConditionalPaths?.get(sourceBlockId)

      // Only process if this is the active condition path
      if (activeCondition === conditionId) {
        if (!this.processedConditionBlocks.has(`${sourceBlockId}-${conn.target}`)) {
          // Check if this is a loop-back connection first
          const loopId = Object.keys(this.workflow.loops || {}).find(
            (id) =>
              this.workflow.loops?.[id].nodes.includes(conn.target) &&
              this.workflow.loops?.[id].nodes.includes(sourceBlockId)
          )

          if (loopId) {
            const loop = this.workflow.loops?.[loopId]
            if (loop) {
              const sourceIndex = loop.nodes.indexOf(sourceBlockId)
              const targetIndex = loop.nodes.indexOf(conn.target)
              const isFeedbackPath = targetIndex < sourceIndex

              if (isFeedbackPath) {
                const iterations = this.loopIterations.get(loopId) || 0
                if (iterations < loop.maxIterations) {
                  // Reset all blocks in the loop
                  this.resetLoopBlocksDegrees(loopId, inDegree, (conn) => {
                    if (!conn.sourceHandle?.startsWith('condition-')) return false
                    const loopBlocks = loop.nodes
                    const srcIndex = loopBlocks.indexOf(conn.source)
                    const tgtIndex = loopBlocks.indexOf(conn.target)
                    return tgtIndex < srcIndex
                  })

                  // Add loop entry block to queue
                  const entryBlock = loop.nodes[0]
                  if (inDegree.get(entryBlock) === 0) {
                    queue.push(entryBlock)
                  }

                  this.loopIterations.set(loopId, iterations + 1)
                }
              }
            }
          }

          const newDegree = (inDegree.get(conn.target) || 0) - 1
          inDegree.set(conn.target, newDegree)
          if (newDegree === 0 && !queue.includes(conn.target)) {
            queue.push(conn.target)
          }
          this.processedConditionBlocks.add(`${sourceBlockId}-${conn.target}`)
        }
      }
    } else {
      const newDegree = (inDegree.get(conn.target) || 0) - 1
      inDegree.set(conn.target, newDegree)
      if (newDegree === 0) queue.push(conn.target)
    }
  }
}
