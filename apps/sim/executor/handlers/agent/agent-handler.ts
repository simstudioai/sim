import { createLogger } from '@/lib/logs/console/logger'
import { createMcpToolId } from '@/lib/mcp/utils'
import { getAllBlocks } from '@/blocks'
import type { BlockOutput } from '@/blocks/types'
import { AGENT, BlockType, DEFAULTS, HTTP } from '@/executor/constants'
import { memoryService } from '@/executor/handlers/agent/memory'
import type {
  AgentInputs,
  Message,
  StreamingConfig,
  ToolInput,
} from '@/executor/handlers/agent/types'
import type { BlockHandler, ExecutionContext, StreamingExecution } from '@/executor/types'
import { collectBlockData } from '@/executor/utils/block-data'
import { buildAPIUrl, buildAuthHeaders, extractAPIErrorMessage } from '@/executor/utils/http'
import { stringifyJSON } from '@/executor/utils/json'
import { executeProviderRequest } from '@/providers'
import { getApiKey, getProviderFromModel, transformBlockTool } from '@/providers/utils'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'
import { getTool, getToolAsync } from '@/tools/utils'

const logger = createLogger('AgentBlockHandler')

/**
 * Handler for Agent blocks that process LLM requests with optional tools.
 */
export class AgentBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.AGENT
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: AgentInputs
  ): Promise<BlockOutput | StreamingExecution> {
    const responseFormat = this.parseResponseFormat(inputs.responseFormat)
    const model = inputs.model || AGENT.DEFAULT_MODEL
    const providerId = getProviderFromModel(model)
    const formattedTools = await this.formatTools(ctx, inputs.tools || [])
    const streamingConfig = this.getStreamingConfig(ctx, block)
    const messages = await this.buildMessages(ctx, inputs, block.id)

    const providerRequest = this.buildProviderRequest({
      ctx,
      providerId,
      model,
      messages,
      inputs,
      formattedTools,
      responseFormat,
      streaming: streamingConfig.shouldUseStreaming ?? false,
    })

    const result = await this.executeProviderRequest(
      ctx,
      providerRequest,
      block,
      responseFormat,
      inputs
    )

    await this.persistResponseToMemory(ctx, inputs, result, block.id)

    return result
  }

  private parseResponseFormat(responseFormat?: string | object): any {
    if (!responseFormat || responseFormat === '') return undefined

    if (typeof responseFormat === 'object' && responseFormat !== null) {
      const formatObj = responseFormat as any
      if (!formatObj.schema && !formatObj.name) {
        return {
          name: 'response_schema',
          schema: responseFormat,
          strict: true,
        }
      }
      return responseFormat
    }

    if (typeof responseFormat === 'string') {
      const trimmedValue = responseFormat.trim()

      if (trimmedValue.startsWith('<') && trimmedValue.includes('>')) {
        return undefined
      }

      try {
        const parsed = JSON.parse(trimmedValue)

        if (parsed && typeof parsed === 'object' && !parsed.schema && !parsed.name) {
          return {
            name: 'response_schema',
            schema: parsed,
            strict: true,
          }
        }
        return parsed
      } catch (error: any) {
        logger.warn('Failed to parse response format as JSON, using default behavior:', {
          error: error.message,
          value: trimmedValue,
        })
        return undefined
      }
    }

    logger.warn('Unexpected response format type, using default behavior:', {
      type: typeof responseFormat,
      value: responseFormat,
    })
    return undefined
  }

  private async formatTools(ctx: ExecutionContext, inputTools: ToolInput[]): Promise<any[]> {
    if (!Array.isArray(inputTools)) return []

    const filtered = inputTools.filter((tool) => {
      const usageControl = tool.usageControl || 'auto'
      return usageControl !== 'none'
    })

    const mcpTools: ToolInput[] = []
    const otherTools: ToolInput[] = []

    for (const tool of filtered) {
      if (tool.type === 'mcp') {
        mcpTools.push(tool)
      } else {
        otherTools.push(tool)
      }
    }

    const otherResults = await Promise.all(
      otherTools.map(async (tool) => {
        try {
          if (tool.type === 'custom-tool' && (tool.schema || tool.customToolId)) {
            return await this.createCustomTool(ctx, tool)
          }
          return this.transformBlockTool(ctx, tool)
        } catch (error) {
          logger.error(`[AgentHandler] Error creating tool:`, { tool, error })
          return null
        }
      })
    )

    const mcpResults = await this.processMcpToolsBatched(ctx, mcpTools)

    const allTools = [...otherResults, ...mcpResults]
    return allTools.filter(
      (tool): tool is NonNullable<typeof tool> => tool !== null && tool !== undefined
    )
  }

  private async createCustomTool(ctx: ExecutionContext, tool: ToolInput): Promise<any> {
    const userProvidedParams = tool.params || {}

    let schema = tool.schema
    let code = tool.code
    let title = tool.title

    if (tool.customToolId && !schema) {
      const resolved = await this.fetchCustomToolById(ctx, tool.customToolId)
      if (!resolved) {
        logger.error(`Custom tool not found: ${tool.customToolId}`)
        return null
      }
      schema = resolved.schema
      code = resolved.code
      title = resolved.title
    }

    if (!schema?.function) {
      logger.error('Custom tool missing schema:', { customToolId: tool.customToolId, title })
      return null
    }

    const { filterSchemaForLLM, mergeToolParameters } = await import('@/tools/params')

    const filteredSchema = filterSchemaForLLM(schema.function.parameters, userProvidedParams)

    const toolId = `${AGENT.CUSTOM_TOOL_PREFIX}${title}`
    const base: any = {
      id: toolId,
      name: schema.function.name,
      description: schema.function.description || '',
      params: userProvidedParams,
      parameters: {
        ...filteredSchema,
        type: schema.function.parameters.type,
      },
      usageControl: tool.usageControl || 'auto',
    }

    if (code) {
      base.executeFunction = async (callParams: Record<string, any>) => {
        const mergedParams = mergeToolParameters(userProvidedParams, callParams)

        const { blockData, blockNameMapping } = collectBlockData(ctx)

        const result = await executeTool(
          'function_execute',
          {
            code,
            ...mergedParams,
            timeout: tool.timeout ?? AGENT.DEFAULT_FUNCTION_TIMEOUT,
            envVars: ctx.environmentVariables || {},
            workflowVariables: ctx.workflowVariables || {},
            blockData,
            blockNameMapping,
            isCustomTool: true,
            _context: {
              workflowId: ctx.workflowId,
              workspaceId: ctx.workspaceId,
            },
          },
          false,
          false,
          ctx
        )

        if (!result.success) {
          throw new Error(result.error || 'Function execution failed')
        }
        return result.output
      }
    }

    return base
  }

  /**
   * Fetches a custom tool definition from the database by ID
   */
  private async fetchCustomToolById(
    ctx: ExecutionContext,
    customToolId: string
  ): Promise<{ schema: any; code: string; title: string } | null> {
    if (typeof window !== 'undefined') {
      try {
        const { useCustomToolsStore } = await import('@/stores/custom-tools/store')
        const tool = useCustomToolsStore.getState().getTool(customToolId)
        if (tool) {
          return {
            schema: tool.schema,
            code: tool.code || '',
            title: tool.title,
          }
        }
        logger.warn(`Custom tool not found in store: ${customToolId}`)
      } catch (error) {
        logger.error('Error accessing custom tools store:', { error })
      }
    }

    try {
      const headers = await buildAuthHeaders()
      const params: Record<string, string> = {}

      if (ctx.workspaceId) {
        params.workspaceId = ctx.workspaceId
      }
      if (ctx.workflowId) {
        params.workflowId = ctx.workflowId
      }

      const url = buildAPIUrl('/api/tools/custom', params)
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers,
      })

      if (!response.ok) {
        logger.error(`Failed to fetch custom tools: ${response.status}`)
        return null
      }

      const data = await response.json()
      if (!data.data || !Array.isArray(data.data)) {
        logger.error('Invalid custom tools API response')
        return null
      }

      const tool = data.data.find((t: any) => t.id === customToolId)
      if (!tool) {
        logger.warn(`Custom tool not found by ID: ${customToolId}`)
        return null
      }

      return {
        schema: tool.schema,
        code: tool.code || '',
        title: tool.title,
      }
    } catch (error) {
      logger.error('Error fetching custom tool:', { customToolId, error })
      return null
    }
  }

  /**
   * Process MCP tools using cached schemas from build time.
   */
  private async processMcpToolsBatched(
    ctx: ExecutionContext,
    mcpTools: ToolInput[]
  ): Promise<any[]> {
    if (mcpTools.length === 0) return []

    const results: any[] = []

    const toolsWithSchema: ToolInput[] = []
    const toolsNeedingDiscovery: ToolInput[] = []

    for (const tool of mcpTools) {
      const serverId = tool.params?.serverId
      const toolName = tool.params?.toolName

      if (!serverId || !toolName) {
        logger.error('MCP tool missing serverId or toolName:', tool)
        continue
      }

      if (tool.schema) {
        toolsWithSchema.push(tool)
      } else {
        logger.warn(`MCP tool ${toolName} missing cached schema, will need discovery`)
        toolsNeedingDiscovery.push(tool)
      }
    }

    for (const tool of toolsWithSchema) {
      try {
        const created = await this.createMcpToolFromCachedSchema(ctx, tool)
        if (created) results.push(created)
      } catch (error) {
        logger.error(`Error creating MCP tool from cached schema:`, { tool, error })
      }
    }

    if (toolsNeedingDiscovery.length > 0) {
      const discoveredResults = await this.processMcpToolsWithDiscovery(ctx, toolsNeedingDiscovery)
      results.push(...discoveredResults)
    }

    return results
  }

  /**
   * Create MCP tool from cached schema. No MCP server connection required.
   */
  private async createMcpToolFromCachedSchema(
    ctx: ExecutionContext,
    tool: ToolInput
  ): Promise<any> {
    const { serverId, toolName, serverName, ...userProvidedParams } = tool.params || {}

    const { filterSchemaForLLM } = await import('@/tools/params')
    const filteredSchema = filterSchemaForLLM(
      tool.schema || { type: 'object', properties: {} },
      userProvidedParams
    )

    const toolId = createMcpToolId(serverId, toolName)

    return {
      id: toolId,
      name: toolName,
      description:
        tool.schema?.description || `MCP tool ${toolName} from ${serverName || serverId}`,
      parameters: filteredSchema,
      params: userProvidedParams,
      usageControl: tool.usageControl || 'auto',
      executeFunction: async (callParams: Record<string, any>) => {
        const headers = await buildAuthHeaders()
        const execUrl = buildAPIUrl('/api/mcp/tools/execute')

        const execResponse = await fetch(execUrl.toString(), {
          method: 'POST',
          headers,
          body: stringifyJSON({
            serverId,
            toolName,
            arguments: callParams,
            workspaceId: ctx.workspaceId,
            workflowId: ctx.workflowId,
            toolSchema: tool.schema,
          }),
        })

        if (!execResponse.ok) {
          throw new Error(
            `MCP tool execution failed: ${execResponse.status} ${execResponse.statusText}`
          )
        }

        const result = await execResponse.json()
        if (!result.success) {
          throw new Error(result.error || 'MCP tool execution failed')
        }

        return {
          success: true,
          output: result.data.output || {},
          metadata: {
            source: 'mcp',
            serverId,
            serverName: serverName || serverId,
            toolName,
          },
        }
      },
    }
  }

  /**
   * Fallback for legacy tools without cached schemas. Groups by server to minimize connections.
   */
  private async processMcpToolsWithDiscovery(
    ctx: ExecutionContext,
    mcpTools: ToolInput[]
  ): Promise<any[]> {
    const toolsByServer = new Map<string, ToolInput[]>()
    for (const tool of mcpTools) {
      const serverId = tool.params?.serverId
      if (!toolsByServer.has(serverId)) {
        toolsByServer.set(serverId, [])
      }
      toolsByServer.get(serverId)!.push(tool)
    }

    const serverDiscoveryResults = await Promise.all(
      Array.from(toolsByServer.entries()).map(async ([serverId, tools]) => {
        try {
          const discoveredTools = await this.discoverMcpToolsForServer(ctx, serverId)
          return { serverId, tools, discoveredTools, error: null as Error | null }
        } catch (error) {
          logger.error(`Failed to discover tools from server ${serverId}:`, error)
          return { serverId, tools, discoveredTools: [] as any[], error: error as Error }
        }
      })
    )

    const results: any[] = []
    for (const { serverId, tools, discoveredTools, error } of serverDiscoveryResults) {
      if (error) continue

      for (const tool of tools) {
        try {
          const toolName = tool.params?.toolName
          const mcpTool = discoveredTools.find((t: any) => t.name === toolName)

          if (!mcpTool) {
            logger.error(`MCP tool ${toolName} not found on server ${serverId}`)
            continue
          }

          const created = await this.createMcpToolFromDiscoveredData(ctx, tool, mcpTool, serverId)
          if (created) results.push(created)
        } catch (error) {
          logger.error(`Error creating MCP tool:`, { tool, error })
        }
      }
    }

    return results
  }

  /**
   * Discover tools from a single MCP server with retry logic.
   */
  private async discoverMcpToolsForServer(ctx: ExecutionContext, serverId: string): Promise<any[]> {
    if (!ctx.workspaceId) {
      throw new Error('workspaceId is required for MCP tool discovery')
    }
    if (!ctx.workflowId) {
      throw new Error('workflowId is required for internal JWT authentication')
    }

    const headers = await buildAuthHeaders()
    const url = buildAPIUrl('/api/mcp/tools/discover', {
      serverId,
      workspaceId: ctx.workspaceId,
      workflowId: ctx.workflowId,
    })

    const maxAttempts = 2
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(url.toString(), { method: 'GET', headers })

        if (!response.ok) {
          const errorText = await response.text()
          if (this.isRetryableError(errorText) && attempt < maxAttempts - 1) {
            logger.warn(
              `[AgentHandler] Session error discovering tools from ${serverId}, retrying (attempt ${attempt + 1})`
            )
            await new Promise((r) => setTimeout(r, 100))
            continue
          }
          throw new Error(`Failed to discover tools: ${response.status} ${errorText}`)
        }

        const data = await response.json()
        if (!data.success) {
          throw new Error(data.error || 'Failed to discover MCP tools')
        }

        return data.data.tools
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        if (this.isRetryableError(errorMsg) && attempt < maxAttempts - 1) {
          logger.warn(
            `[AgentHandler] Retryable error discovering tools from ${serverId} (attempt ${attempt + 1}):`,
            error
          )
          await new Promise((r) => setTimeout(r, 100))
          continue
        }
        throw error
      }
    }

    throw new Error(
      `Failed to discover tools from server ${serverId} after ${maxAttempts} attempts`
    )
  }

  private isRetryableError(errorMsg: string): boolean {
    const lowerMsg = errorMsg.toLowerCase()
    return lowerMsg.includes('session') || lowerMsg.includes('400') || lowerMsg.includes('404')
  }

  private async createMcpToolFromDiscoveredData(
    ctx: ExecutionContext,
    tool: ToolInput,
    mcpTool: any,
    serverId: string
  ): Promise<any> {
    const { toolName, ...userProvidedParams } = tool.params || {}

    const { filterSchemaForLLM } = await import('@/tools/params')
    const filteredSchema = filterSchemaForLLM(
      mcpTool.inputSchema || { type: 'object', properties: {} },
      userProvidedParams
    )

    const toolId = createMcpToolId(serverId, toolName)

    return {
      id: toolId,
      name: toolName,
      description: mcpTool.description || `MCP tool ${toolName} from ${mcpTool.serverName}`,
      parameters: filteredSchema,
      params: userProvidedParams,
      usageControl: tool.usageControl || 'auto',
      executeFunction: async (callParams: Record<string, any>) => {
        const headers = await buildAuthHeaders()
        const execUrl = buildAPIUrl('/api/mcp/tools/execute')

        const execResponse = await fetch(execUrl.toString(), {
          method: 'POST',
          headers,
          body: stringifyJSON({
            serverId,
            toolName,
            arguments: callParams,
            workspaceId: ctx.workspaceId,
            workflowId: ctx.workflowId,
            toolSchema: mcpTool.inputSchema,
          }),
        })

        if (!execResponse.ok) {
          throw new Error(
            `MCP tool execution failed: ${execResponse.status} ${execResponse.statusText}`
          )
        }

        const result = await execResponse.json()
        if (!result.success) {
          throw new Error(result.error || 'MCP tool execution failed')
        }

        return {
          success: true,
          output: result.data.output || {},
          metadata: {
            source: 'mcp',
            serverId,
            serverName: mcpTool.serverName,
            toolName,
          },
        }
      },
    }
  }

  private async transformBlockTool(ctx: ExecutionContext, tool: ToolInput) {
    const transformedTool = await transformBlockTool(tool, {
      selectedOperation: tool.operation,
      getAllBlocks,
      getToolAsync: (toolId: string) => getToolAsync(toolId, ctx.workflowId),
      getTool,
    })

    if (transformedTool) {
      transformedTool.usageControl = tool.usageControl || 'auto'
    }
    return transformedTool
  }

  private getStreamingConfig(ctx: ExecutionContext, block: SerializedBlock): StreamingConfig {
    const isBlockSelectedForOutput =
      ctx.selectedOutputs?.some((outputId) => {
        if (outputId === block.id) return true
        const firstUnderscoreIndex = outputId.indexOf('_')
        return (
          firstUnderscoreIndex !== -1 && outputId.substring(0, firstUnderscoreIndex) === block.id
        )
      }) ?? false

    const hasOutgoingConnections = ctx.edges?.some((edge) => edge.source === block.id) ?? false
    const shouldUseStreaming = Boolean(ctx.stream) && isBlockSelectedForOutput

    return { shouldUseStreaming, isBlockSelectedForOutput, hasOutgoingConnections }
  }

  private async buildMessages(
    ctx: ExecutionContext,
    inputs: AgentInputs,
    blockId: string
  ): Promise<Message[] | undefined> {
    const messages: Message[] = []

    // 1. Fetch memory history if configured (industry standard: chronological order)
    if (inputs.memoryType && inputs.memoryType !== 'none') {
      const memoryMessages = await memoryService.fetchMemoryMessages(ctx, inputs, blockId)
      messages.push(...memoryMessages)
    }

    // 2. Process legacy memories (backward compatibility - from Memory block)
    if (inputs.memories) {
      messages.push(...this.processMemories(inputs.memories))
    }

    // 3. Add messages array (new approach - from messages-input subblock)
    if (inputs.messages && Array.isArray(inputs.messages)) {
      const validMessages = inputs.messages.filter(
        (msg) =>
          msg &&
          typeof msg === 'object' &&
          'role' in msg &&
          'content' in msg &&
          ['system', 'user', 'assistant'].includes(msg.role)
      )
      messages.push(...validMessages)
    }

    // Warn if using both new and legacy input formats
    if (
      inputs.messages &&
      inputs.messages.length > 0 &&
      (inputs.systemPrompt || inputs.userPrompt)
    ) {
      logger.warn('Agent block using both messages array and legacy prompts', {
        hasMessages: true,
        hasSystemPrompt: !!inputs.systemPrompt,
        hasUserPrompt: !!inputs.userPrompt,
      })
    }

    // 4. Handle legacy systemPrompt (backward compatibility)
    // Only add if no system message exists yet
    if (inputs.systemPrompt && !messages.some((m) => m.role === 'system')) {
      this.addSystemPrompt(messages, inputs.systemPrompt)
    }

    // 5. Handle legacy userPrompt (backward compatibility)
    if (inputs.userPrompt) {
      this.addUserPrompt(messages, inputs.userPrompt)
    }

    // 6. Persist user message(s) to memory if configured
    // This ensures conversation history is complete before agent execution
    if (inputs.memoryType && inputs.memoryType !== 'none' && messages.length > 0) {
      // Find new user messages that need to be persisted
      // (messages added via messages array or userPrompt)
      const userMessages = messages.filter((m) => m.role === 'user')
      const lastUserMessage = userMessages[userMessages.length - 1]

      // Only persist if there's a user message AND it's from userPrompt or messages input
      // (not from memory history which was already persisted)
      if (
        lastUserMessage &&
        (inputs.userPrompt || (inputs.messages && inputs.messages.length > 0))
      ) {
        await memoryService.persistUserMessage(ctx, inputs, lastUserMessage, blockId)
      }
    }

    // Return messages or undefined if empty (maintains API compatibility)
    return messages.length > 0 ? messages : undefined
  }

  private processMemories(memories: any): Message[] {
    if (!memories) return []

    let memoryArray: any[] = []
    if (memories?.memories && Array.isArray(memories.memories)) {
      memoryArray = memories.memories
    } else if (Array.isArray(memories)) {
      memoryArray = memories
    }

    const messages: Message[] = []
    memoryArray.forEach((memory: any) => {
      if (memory.data && Array.isArray(memory.data)) {
        memory.data.forEach((msg: any) => {
          if (msg.role && msg.content && ['system', 'user', 'assistant'].includes(msg.role)) {
            messages.push({
              role: msg.role as 'system' | 'user' | 'assistant',
              content: msg.content,
            })
          }
        })
      } else if (
        memory.role &&
        memory.content &&
        ['system', 'user', 'assistant'].includes(memory.role)
      ) {
        messages.push({
          role: memory.role as 'system' | 'user' | 'assistant',
          content: memory.content,
        })
      }
    })

    return messages
  }

  /**
   * Ensures system message is at position 0 (industry standard)
   * Preserves existing system message if already at position 0, otherwise adds/moves it
   */
  private addSystemPrompt(messages: Message[], systemPrompt: any) {
    let content: string

    if (typeof systemPrompt === 'string') {
      content = systemPrompt
    } else {
      try {
        content = JSON.stringify(systemPrompt, null, 2)
      } catch (error) {
        content = String(systemPrompt)
      }
    }

    // Find first system message
    const firstSystemIndex = messages.findIndex((msg) => msg.role === 'system')

    if (firstSystemIndex === -1) {
      // No system message exists - add at position 0
      messages.unshift({ role: 'system', content })
    } else if (firstSystemIndex === 0) {
      // System message already at position 0 - replace it
      // Explicit systemPrompt parameter takes precedence over memory/messages
      messages[0] = { role: 'system', content }
    } else {
      // System message exists but not at position 0 - move it to position 0
      // and update with new content
      messages.splice(firstSystemIndex, 1)
      messages.unshift({ role: 'system', content })
    }

    // Remove any additional system messages (keep only the first one)
    for (let i = messages.length - 1; i >= 1; i--) {
      if (messages[i].role === 'system') {
        messages.splice(i, 1)
        logger.warn('Removed duplicate system message from conversation history', {
          position: i,
        })
      }
    }
  }

  private addUserPrompt(messages: Message[], userPrompt: any) {
    let content: string
    if (typeof userPrompt === 'object' && userPrompt.input) {
      content = String(userPrompt.input)
    } else if (typeof userPrompt === 'object') {
      content = JSON.stringify(userPrompt)
    } else {
      content = String(userPrompt)
    }

    messages.push({ role: 'user', content })
  }

  private buildProviderRequest(config: {
    ctx: ExecutionContext
    providerId: string
    model: string
    messages: Message[] | undefined
    inputs: AgentInputs
    formattedTools: any[]
    responseFormat: any
    streaming: boolean
  }) {
    const { ctx, providerId, model, messages, inputs, formattedTools, responseFormat, streaming } =
      config

    const validMessages = this.validateMessages(messages)

    const { blockData, blockNameMapping } = collectBlockData(ctx)

    return {
      provider: providerId,
      model,
      systemPrompt: validMessages ? undefined : inputs.systemPrompt,
      context: validMessages ? undefined : stringifyJSON(messages),
      tools: formattedTools,
      temperature: inputs.temperature,
      maxTokens: inputs.maxTokens,
      apiKey: inputs.apiKey,
      azureEndpoint: inputs.azureEndpoint,
      azureApiVersion: inputs.azureApiVersion,
      responseFormat,
      workflowId: ctx.workflowId,
      workspaceId: ctx.workspaceId,
      stream: streaming,
      messages,
      environmentVariables: ctx.environmentVariables || {},
      workflowVariables: ctx.workflowVariables || {},
      blockData,
      blockNameMapping,
      reasoningEffort: inputs.reasoningEffort,
      verbosity: inputs.verbosity,
    }
  }

  private validateMessages(messages: Message[] | undefined): boolean {
    return (
      Array.isArray(messages) &&
      messages.length > 0 &&
      messages.every(
        (msg: any) =>
          typeof msg === 'object' &&
          msg !== null &&
          'role' in msg &&
          typeof msg.role === 'string' &&
          ('content' in msg ||
            (msg.role === 'assistant' && ('function_call' in msg || 'tool_calls' in msg)))
      )
    )
  }

  private async executeProviderRequest(
    ctx: ExecutionContext,
    providerRequest: any,
    block: SerializedBlock,
    responseFormat: any,
    inputs: AgentInputs
  ): Promise<BlockOutput | StreamingExecution> {
    const providerId = providerRequest.provider
    const model = providerRequest.model
    const providerStartTime = Date.now()

    try {
      const isBrowser = typeof window !== 'undefined'

      if (!isBrowser) {
        return this.executeServerSide(
          ctx,
          providerRequest,
          providerId,
          model,
          block,
          responseFormat,
          providerStartTime
        )
      }
      return this.executeBrowserSide(
        ctx,
        providerRequest,
        block,
        responseFormat,
        providerStartTime,
        inputs
      )
    } catch (error) {
      this.handleExecutionError(error, providerStartTime, providerId, model, ctx, block)
      throw error
    }
  }

  private async executeServerSide(
    ctx: ExecutionContext,
    providerRequest: any,
    providerId: string,
    model: string,
    block: SerializedBlock,
    responseFormat: any,
    providerStartTime: number
  ) {
    const finalApiKey = this.getApiKey(providerId, model, providerRequest.apiKey)

    const { blockData, blockNameMapping } = collectBlockData(ctx)

    const response = await executeProviderRequest(providerId, {
      model,
      systemPrompt: 'systemPrompt' in providerRequest ? providerRequest.systemPrompt : undefined,
      context: 'context' in providerRequest ? providerRequest.context : undefined,
      tools: providerRequest.tools,
      temperature: providerRequest.temperature,
      maxTokens: providerRequest.maxTokens,
      apiKey: finalApiKey,
      azureEndpoint: providerRequest.azureEndpoint,
      azureApiVersion: providerRequest.azureApiVersion,
      responseFormat: providerRequest.responseFormat,
      workflowId: providerRequest.workflowId,
      workspaceId: providerRequest.workspaceId,
      stream: providerRequest.stream,
      messages: 'messages' in providerRequest ? providerRequest.messages : undefined,
      environmentVariables: ctx.environmentVariables || {},
      workflowVariables: ctx.workflowVariables || {},
      blockData,
      blockNameMapping,
    })

    this.logExecutionSuccess(providerId, model, ctx, block, providerStartTime, response)
    return this.processProviderResponse(response, block, responseFormat)
  }

  private async executeBrowserSide(
    ctx: ExecutionContext,
    providerRequest: any,
    block: SerializedBlock,
    responseFormat: any,
    providerStartTime: number,
    inputs: AgentInputs
  ) {
    const url = buildAPIUrl('/api/providers')
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': HTTP.CONTENT_TYPE.JSON },
      body: stringifyJSON(providerRequest),
      signal: AbortSignal.timeout(AGENT.REQUEST_TIMEOUT),
    })

    if (!response.ok) {
      const errorMessage = await extractAPIErrorMessage(response)
      throw new Error(errorMessage)
    }

    this.logExecutionSuccess(
      providerRequest.provider,
      providerRequest.model,
      ctx,
      block,
      providerStartTime,
      'HTTP response'
    )

    const contentType = response.headers.get('Content-Type')
    if (contentType?.includes(HTTP.CONTENT_TYPE.EVENT_STREAM)) {
      return this.handleStreamingResponse(response, block, ctx, inputs)
    }

    const result = await response.json()
    return this.processProviderResponse(result, block, responseFormat)
  }

  private async handleStreamingResponse(
    response: Response,
    block: SerializedBlock,
    ctx?: ExecutionContext,
    inputs?: AgentInputs
  ): Promise<StreamingExecution> {
    const executionDataHeader = response.headers.get('X-Execution-Data')

    if (executionDataHeader) {
      try {
        const executionData = JSON.parse(executionDataHeader)

        // If execution data contains content or tool calls, persist to memory
        if (
          ctx &&
          inputs &&
          (executionData.output?.content || executionData.output?.toolCalls?.list?.length)
        ) {
          const toolCalls = executionData.output?.toolCalls?.list
          const messages = this.buildMessagesForMemory(executionData.output.content, toolCalls)

          // Fire and forget - don't await, persist all messages
          Promise.all(
            messages.map((message) =>
              memoryService.persistMemoryMessage(ctx, inputs, message, block.id)
            )
          ).catch((error) => logger.error('Failed to persist streaming response to memory:', error))
        }

        return {
          stream: response.body!,
          execution: {
            success: executionData.success,
            output: executionData.output || {},
            error: executionData.error,
            logs: [],
            metadata: executionData.metadata || {
              duration: DEFAULTS.EXECUTION_TIME,
              startTime: new Date().toISOString(),
            },
            isStreaming: true,
            blockId: block.id,
            blockName: block.metadata?.name,
            blockType: block.metadata?.id,
          } as any,
        }
      } catch (error) {
        logger.error('Failed to parse execution data from header:', error)
      }
    }

    return this.createMinimalStreamingExecution(response.body!)
  }

  private getApiKey(providerId: string, model: string, inputApiKey: string): string {
    try {
      return getApiKey(providerId, model, inputApiKey)
    } catch (error) {
      logger.error('Failed to get API key:', {
        provider: providerId,
        model,
        error: error instanceof Error ? error.message : String(error),
        hasProvidedApiKey: !!inputApiKey,
      })
      throw new Error(error instanceof Error ? error.message : 'API key error')
    }
  }

  private logExecutionSuccess(
    provider: string,
    model: string,
    ctx: ExecutionContext,
    block: SerializedBlock,
    startTime: number,
    response: any
  ) {
    const executionTime = Date.now() - startTime
    const responseType =
      response instanceof ReadableStream
        ? 'stream'
        : response && typeof response === 'object' && 'stream' in response
          ? 'streaming-execution'
          : 'json'
  }

  private handleExecutionError(
    error: any,
    startTime: number,
    provider: string,
    model: string,
    ctx: ExecutionContext,
    block: SerializedBlock
  ) {
    const executionTime = Date.now() - startTime

    logger.error('Error executing provider request:', {
      error,
      executionTime,
      provider,
      model,
      workflowId: ctx.workflowId,
      blockId: block.id,
    })

    if (!(error instanceof Error)) return

    logger.error('Provider request error details', {
      workflowId: ctx.workflowId,
      blockId: block.id,
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
      timestamp: new Date().toISOString(),
    })

    if (error.name === 'AbortError') {
      throw new Error('Provider request timed out - the API took too long to respond')
    }
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error(
        'Network error - unable to connect to provider API. Please check your internet connection.'
      )
    }
    if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
      throw new Error('Unable to connect to server - DNS or connection issue')
    }
  }

  private async persistResponseToMemory(
    ctx: ExecutionContext,
    inputs: AgentInputs,
    result: BlockOutput | StreamingExecution,
    blockId: string
  ): Promise<void> {
    // Only persist if memoryType is configured
    if (!inputs.memoryType || inputs.memoryType === 'none') {
      return
    }

    try {
      // Don't persist streaming responses here - they're handled separately
      if (this.isStreamingExecution(result)) {
        return
      }

      // Extract content and tool calls from regular response
      const blockOutput = result as any
      const content = blockOutput?.content
      const toolCalls = blockOutput?.toolCalls?.list

      // Build messages to persist
      const messages = this.buildMessagesForMemory(content, toolCalls)

      if (messages.length === 0) {
        return
      }

      // Persist all messages
      for (const message of messages) {
        await memoryService.persistMemoryMessage(ctx, inputs, message, blockId)
      }

      logger.debug('Persisted assistant response to memory', {
        workflowId: ctx.workflowId,
        memoryType: inputs.memoryType,
        conversationId: inputs.conversationId,
        messageCount: messages.length,
      })
    } catch (error) {
      logger.error('Failed to persist response to memory:', error)
      // Don't throw - memory persistence failure shouldn't break workflow execution
    }
  }

  /**
   * Builds messages for memory storage including tool calls and results
   * Returns proper OpenAI-compatible message format:
   * - Assistant message with tool_calls array (if tools were used)
   * - Tool role messages with results (one per tool call)
   * - Final assistant message with content (if present)
   */
  private buildMessagesForMemory(
    content: string | undefined,
    toolCalls: any[] | undefined
  ): Message[] {
    const messages: Message[] = []

    if (toolCalls?.length) {
      // Generate stable IDs for each tool call (only if not provided by provider)
      // Use index to ensure uniqueness even for same tool name in same millisecond
      const toolCallsWithIds = toolCalls.map((tc: any, index: number) => ({
        ...tc,
        _stableId:
          tc.id ||
          `call_${tc.name}_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
      }))

      // Add assistant message with tool_calls
      const formattedToolCalls = toolCallsWithIds.map((tc: any) => ({
        id: tc._stableId,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: tc.rawArguments || JSON.stringify(tc.arguments || {}),
        },
      }))

      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: formattedToolCalls,
      })

      // Add tool result messages using the same stable IDs
      for (const tc of toolCallsWithIds) {
        const resultContent =
          typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result || {})
        messages.push({
          role: 'tool',
          content: resultContent,
          tool_call_id: tc._stableId,
          name: tc.name, // Store tool name for providers that need it (e.g., Google/Gemini)
        })
      }
    }

    // Add final assistant response if present
    if (content && typeof content === 'string') {
      messages.push({
        role: 'assistant',
        content,
      })
    }

    return messages
  }

  private processProviderResponse(
    response: any,
    block: SerializedBlock,
    responseFormat: any
  ): BlockOutput | StreamingExecution {
    if (this.isStreamingExecution(response)) {
      return this.processStreamingExecution(response, block)
    }

    if (response instanceof ReadableStream) {
      return this.createMinimalStreamingExecution(response)
    }

    return this.processRegularResponse(response, responseFormat)
  }

  private isStreamingExecution(response: any): boolean {
    return (
      response && typeof response === 'object' && 'stream' in response && 'execution' in response
    )
  }

  private processStreamingExecution(
    response: StreamingExecution,
    block: SerializedBlock
  ): StreamingExecution {
    const streamingExec = response as StreamingExecution

    if (streamingExec.execution.output) {
      const execution = streamingExec.execution as any
      if (block.metadata?.name) execution.blockName = block.metadata.name
      if (block.metadata?.id) execution.blockType = block.metadata.id
      execution.blockId = block.id
      execution.isStreaming = true
    }

    return streamingExec
  }

  private createMinimalStreamingExecution(stream: ReadableStream): StreamingExecution {
    return {
      stream,
      execution: {
        success: true,
        output: {},
        logs: [],
        metadata: {
          duration: DEFAULTS.EXECUTION_TIME,
          startTime: new Date().toISOString(),
        },
      },
    }
  }

  private processRegularResponse(result: any, responseFormat: any): BlockOutput {
    if (responseFormat) {
      return this.processStructuredResponse(result, responseFormat)
    }

    return this.processStandardResponse(result)
  }

  private processStructuredResponse(result: any, responseFormat: any): BlockOutput {
    const content = result.content

    try {
      const extractedJson = JSON.parse(content.trim())
      return {
        ...extractedJson,
        ...this.createResponseMetadata(result),
      }
    } catch (error) {
      logger.error('LLM did not adhere to structured response format:', {
        content: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
        responseFormat: responseFormat,
      })

      const standardResponse = this.processStandardResponse(result)
      return Object.assign(standardResponse, {
        _responseFormatWarning:
          'LLM did not adhere to the specified structured response format. Expected valid JSON but received malformed content. Falling back to standard format.',
      })
    }
  }

  private processStandardResponse(result: any): BlockOutput {
    return {
      content: result.content,
      model: result.model,
      ...this.createResponseMetadata(result),
    }
  }

  private createResponseMetadata(result: {
    tokens?: { prompt?: number; completion?: number; total?: number }
    toolCalls?: Array<any>
    timing?: any
    cost?: any
  }) {
    return {
      tokens: result.tokens || {
        prompt: DEFAULTS.TOKENS.PROMPT,
        completion: DEFAULTS.TOKENS.COMPLETION,
        total: DEFAULTS.TOKENS.TOTAL,
      },
      toolCalls: {
        list: result.toolCalls?.map(this.formatToolCall.bind(this)) || [],
        count: result.toolCalls?.length || DEFAULTS.EXECUTION_TIME,
      },
      providerTiming: result.timing,
      cost: result.cost,
    }
  }

  private formatToolCall(tc: any) {
    const toolName = this.stripCustomToolPrefix(tc.name)

    return {
      ...tc,
      name: toolName,
      startTime: tc.startTime,
      endTime: tc.endTime,
      duration: tc.duration,
      arguments: tc.arguments || tc.input || {},
      result: tc.result || tc.output,
    }
  }

  private stripCustomToolPrefix(name: string): string {
    return name.startsWith(AGENT.CUSTOM_TOOL_PREFIX)
      ? name.replace(AGENT.CUSTOM_TOOL_PREFIX, '')
      : name
  }
}
