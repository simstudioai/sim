import { createLogger } from '@/lib/logs/console/logger'
import { createMcpToolId } from '@/lib/mcp/utils'
import { getAllBlocks } from '@/blocks'
import type { BlockOutput } from '@/blocks/types'
import { AGENT, BlockType, DEFAULTS, HTTP } from '@/executor/consts'
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
    const messages = this.buildMessages(inputs)

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

    return this.executeProviderRequest(ctx, providerRequest, block, responseFormat)
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

    const tools = await Promise.all(
      inputTools
        .filter((tool) => {
          const usageControl = tool.usageControl || 'auto'
          return usageControl !== 'none'
        })
        .map(async (tool) => {
          try {
            if (tool.type === 'custom-tool' && tool.schema) {
              return await this.createCustomTool(ctx, tool)
            }
            if (tool.type === 'mcp') {
              return await this.createMcpTool(ctx, tool)
            }
            return this.transformBlockTool(ctx, tool)
          } catch (error) {
            logger.error(`[AgentHandler] Error creating tool:`, { tool, error })
            return null
          }
        })
    )

    const filteredTools = tools.filter(
      (tool): tool is NonNullable<typeof tool> => tool !== null && tool !== undefined
    )

    return filteredTools
  }

  private async createCustomTool(ctx: ExecutionContext, tool: ToolInput): Promise<any> {
    const userProvidedParams = tool.params || {}

    const { filterSchemaForLLM, mergeToolParameters } = await import('@/tools/params')

    const filteredSchema = filterSchemaForLLM(tool.schema.function.parameters, userProvidedParams)

    const toolId = `${AGENT.CUSTOM_TOOL_PREFIX}${tool.title}`
    const base: any = {
      id: toolId,
      name: tool.schema.function.name,
      description: tool.schema.function.description || '',
      params: userProvidedParams,
      parameters: {
        ...filteredSchema,
        type: tool.schema.function.parameters.type,
      },
      usageControl: tool.usageControl || 'auto',
    }

    if (tool.code) {
      base.executeFunction = async (callParams: Record<string, any>) => {
        const mergedParams = mergeToolParameters(userProvidedParams, callParams)

        const { blockData, blockNameMapping } = collectBlockData(ctx)

        const result = await executeTool(
          'function_execute',
          {
            code: tool.code,
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

  private async createMcpTool(ctx: ExecutionContext, tool: ToolInput): Promise<any> {
    const { serverId, toolName, ...userProvidedParams } = tool.params || {}

    if (!serverId || !toolName) {
      logger.error('MCP tool missing required parameters:', { serverId, toolName })
      return null
    }

    try {
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

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers,
      })
      if (!response.ok) {
        throw new Error(`Failed to discover tools from server ${serverId}`)
      }

      const data = await response.json()
      if (!data.success) {
        throw new Error(data.error || 'Failed to discover MCP tools')
      }

      const mcpTool = data.data.tools.find((t: any) => t.name === toolName)
      if (!mcpTool) {
        throw new Error(`MCP tool ${toolName} not found on server ${serverId}`)
      }

      const toolId = createMcpToolId(serverId, toolName)

      const { filterSchemaForLLM } = await import('@/tools/params')
      const filteredSchema = filterSchemaForLLM(
        mcpTool.inputSchema || { type: 'object', properties: {} },
        userProvidedParams
      )

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
    } catch (error) {
      logger.error(`Failed to create MCP tool ${toolName} from server ${serverId}:`, error)
      return null
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

  private buildMessages(inputs: AgentInputs): Message[] | undefined {
    if (!inputs.memories && !(inputs.systemPrompt && inputs.userPrompt)) {
      return undefined
    }

    const messages: Message[] = []

    if (inputs.memories) {
      messages.push(...this.processMemories(inputs.memories))
    }

    if (inputs.systemPrompt) {
      this.addSystemPrompt(messages, inputs.systemPrompt)
    }

    if (inputs.userPrompt) {
      this.addUserPrompt(messages, inputs.userPrompt)
    }

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

    const systemMessages = messages.filter((msg) => msg.role === 'system')

    if (systemMessages.length > 0) {
      messages.splice(0, 0, { role: 'system', content })
      for (let i = messages.length - 1; i >= 1; i--) {
        if (messages[i].role === 'system') {
          messages.splice(i, 1)
        }
      }
    } else {
      messages.splice(0, 0, { role: 'system', content })
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
      context: stringifyJSON(messages),
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
    responseFormat: any
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
      return this.executeBrowserSide(ctx, providerRequest, block, responseFormat, providerStartTime)
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
    providerStartTime: number
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
      return this.handleStreamingResponse(response, block)
    }

    const result = await response.json()
    return this.processProviderResponse(result, block, responseFormat)
  }

  private async handleStreamingResponse(
    response: Response,
    block: SerializedBlock
  ): Promise<StreamingExecution> {
    const executionDataHeader = response.headers.get('X-Execution-Data')

    if (executionDataHeader) {
      try {
        const executionData = JSON.parse(executionDataHeader)

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
