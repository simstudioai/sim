import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import { getAllBlocks } from '@/blocks'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/consts'
import type {
  AgentInputs,
  Message,
  StreamingConfig,
  ToolInput,
} from '@/executor/handlers/agent/types'
import type { BlockHandler, ExecutionContext, StreamingExecution } from '@/executor/types'
import { executeProviderRequest } from '@/providers'
import { getApiKey, getProviderFromModel, transformBlockTool } from '@/providers/utils'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'
import { getTool, getToolAsync } from '@/tools/utils'

const logger = createLogger('AgentBlockHandler')

const DEFAULT_MODEL = 'gpt-4o'
const DEFAULT_FUNCTION_TIMEOUT = 5000
const REQUEST_TIMEOUT = 120000
const CUSTOM_TOOL_PREFIX = 'custom_'

/**
 * Handler for Agent blocks that process LLM requests with optional tools.
 */
export class AgentBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.AGENT
  }

  async execute(
    block: SerializedBlock,
    inputs: AgentInputs,
    context: ExecutionContext
  ): Promise<BlockOutput | StreamingExecution> {
    logger.info(`Executing agent block: ${block.id}`)

    const responseFormat = this.parseResponseFormat(inputs.responseFormat)
    const model = inputs.model || DEFAULT_MODEL
    const providerId = getProviderFromModel(model)
    const formattedTools = await this.formatTools(inputs.tools || [], context)
    const streamingConfig = this.getStreamingConfig(block, context)
    const messages = this.buildMessages(inputs)

    const providerRequest = this.buildProviderRequest({
      providerId,
      model,
      messages,
      inputs,
      formattedTools,
      responseFormat,
      context,
      streaming: streamingConfig.shouldUseStreaming ?? false,
    })

    this.logRequestDetails(providerRequest, messages, streamingConfig)

    return this.executeProviderRequest(providerRequest, block, responseFormat, context)
  }

  private parseResponseFormat(responseFormat?: string | object): any {
    if (!responseFormat || responseFormat === '') return undefined

    // If already an object, process it directly
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

    // Handle string values
    if (typeof responseFormat === 'string') {
      const trimmedValue = responseFormat.trim()

      // Check for variable references like <start.input>
      if (trimmedValue.startsWith('<') && trimmedValue.includes('>')) {
        logger.info('Response format contains variable reference:', {
          value: trimmedValue,
        })
        // Variable references should have been resolved by the resolver before reaching here
        // If we still have a variable reference, it means it couldn't be resolved
        // Return undefined to use default behavior (no structured response)
        return undefined
      }

      // Try to parse as JSON
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
        // Return undefined instead of throwing - this allows execution to continue
        // without structured response format
        return undefined
      }
    }

    // For any other type, return undefined
    logger.warn('Unexpected response format type, using default behavior:', {
      type: typeof responseFormat,
      value: responseFormat,
    })
    return undefined
  }

  private async formatTools(inputTools: ToolInput[], context: ExecutionContext): Promise<any[]> {
    if (!Array.isArray(inputTools)) return []

    const tools = await Promise.all(
      inputTools
        .filter((tool) => {
          const usageControl = tool.usageControl || 'auto'
          return usageControl !== 'none'
        })
        .map(async (tool) => {
          if (tool.type === 'custom-tool' && tool.schema) {
            return await this.createCustomTool(tool, context)
          }
          return this.transformBlockTool(tool, context)
        })
    )

    return tools.filter(
      (tool): tool is NonNullable<typeof tool> => tool !== null && tool !== undefined
    )
  }

  private async createCustomTool(tool: ToolInput, context: ExecutionContext): Promise<any> {
    const userProvidedParams = tool.params || {}

    // Import the utility function
    const { filterSchemaForLLM, mergeToolParameters } = await import('../../../tools/params')

    // Create schema excluding user-provided parameters
    const filteredSchema = filterSchemaForLLM(tool.schema.function.parameters, userProvidedParams)

    const toolId = `${CUSTOM_TOOL_PREFIX}${tool.title}`
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
        // Merge user-provided parameters with LLM-generated parameters
        const mergedParams = mergeToolParameters(userProvidedParams, callParams)

        const result = await executeTool('function_execute', {
          code: tool.code,
          ...mergedParams,
          timeout: tool.timeout ?? DEFAULT_FUNCTION_TIMEOUT,
          envVars: context.environmentVariables || {},
          isCustomTool: true,
          _context: { workflowId: context.workflowId },
        })

        if (!result.success) {
          throw new Error(result.error || 'Function execution failed')
        }
        return result.output
      }
    }

    return base
  }

  private async transformBlockTool(tool: ToolInput, context: ExecutionContext) {
    const transformedTool = await transformBlockTool(tool, {
      selectedOperation: tool.operation,
      getAllBlocks,
      getToolAsync: (toolId: string) => getToolAsync(toolId, context.workflowId),
      getTool,
    })

    if (transformedTool) {
      transformedTool.usageControl = tool.usageControl || 'auto'
    }
    return transformedTool
  }

  private getStreamingConfig(block: SerializedBlock, context: ExecutionContext): StreamingConfig {
    const isBlockSelectedForOutput =
      context.selectedOutputIds?.some((outputId) => {
        if (outputId === block.id) return true
        const firstUnderscoreIndex = outputId.indexOf('_')
        return (
          firstUnderscoreIndex !== -1 && outputId.substring(0, firstUnderscoreIndex) === block.id
        )
      }) ?? false

    const hasOutgoingConnections = context.edges?.some((edge) => edge.source === block.id) ?? false
    const shouldUseStreaming = Boolean(context.stream) && isBlockSelectedForOutput

    if (shouldUseStreaming) {
      logger.info(`Block ${block.id} will use streaming response`)
    }

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
    let content = userPrompt
    if (typeof userPrompt === 'object' && userPrompt.input) {
      content = userPrompt.input
    } else if (typeof userPrompt === 'object') {
      content = JSON.stringify(userPrompt)
    }

    messages.push({ role: 'user', content })
  }

  private buildProviderRequest(config: {
    providerId: string
    model: string
    messages: Message[] | undefined
    inputs: AgentInputs
    formattedTools: any[]
    responseFormat: any
    context: ExecutionContext
    streaming: boolean
  }) {
    const {
      providerId,
      model,
      messages,
      inputs,
      formattedTools,
      responseFormat,
      context,
      streaming,
    } = config

    const validMessages = this.validateMessages(messages)

    return {
      provider: providerId,
      model,
      systemPrompt: validMessages ? undefined : inputs.systemPrompt,
      context: JSON.stringify(messages),
      tools: formattedTools,
      temperature: inputs.temperature,
      maxTokens: inputs.maxTokens,
      apiKey: inputs.apiKey,
      azureEndpoint: inputs.azureEndpoint,
      azureApiVersion: inputs.azureApiVersion,
      responseFormat,
      workflowId: context.workflowId,
      stream: streaming,
      messages,
      environmentVariables: context.environmentVariables || {},
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

  private logRequestDetails(
    providerRequest: any,
    messages: Message[] | undefined,
    streamingConfig: StreamingConfig
  ) {
    logger.info('Provider request prepared', {
      model: providerRequest.model,
      hasMessages: !!messages?.length,
      hasSystemPrompt: !messages?.length && !!providerRequest.systemPrompt,
      hasContext: !messages?.length && !!providerRequest.context,
      hasTools: !!providerRequest.tools,
      hasApiKey: !!providerRequest.apiKey,
      workflowId: providerRequest.workflowId,
      stream: providerRequest.stream,
      messagesCount: messages?.length || 0,
    })
  }

  private async executeProviderRequest(
    providerRequest: any,
    block: SerializedBlock,
    responseFormat: any,
    context: ExecutionContext
  ): Promise<BlockOutput | StreamingExecution> {
    const providerId = providerRequest.provider
    const model = providerRequest.model
    const providerStartTime = Date.now()

    try {
      const isBrowser = typeof window !== 'undefined'

      if (!isBrowser) {
        return this.executeServerSide(
          providerRequest,
          providerId,
          model,
          block,
          responseFormat,
          context,
          providerStartTime
        )
      }
      return this.executeBrowserSide(
        providerRequest,
        block,
        responseFormat,
        context,
        providerStartTime
      )
    } catch (error) {
      this.handleExecutionError(error, providerStartTime, providerId, model, context, block)
      throw error
    }
  }

  private async executeServerSide(
    providerRequest: any,
    providerId: string,
    model: string,
    block: SerializedBlock,
    responseFormat: any,
    context: ExecutionContext,
    providerStartTime: number
  ) {
    logger.info('Using direct provider execution (server environment)')

    const finalApiKey = this.getApiKey(providerId, model, providerRequest.apiKey)

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
      stream: providerRequest.stream,
      messages: 'messages' in providerRequest ? providerRequest.messages : undefined,
      environmentVariables: context.environmentVariables || {},
    })

    this.logExecutionSuccess(providerId, model, context, block, providerStartTime, response)
    return this.processProviderResponse(response, block, responseFormat)
  }

  private async executeBrowserSide(
    providerRequest: any,
    block: SerializedBlock,
    responseFormat: any,
    context: ExecutionContext,
    providerStartTime: number
  ) {
    logger.info('Using HTTP provider request (browser environment)')

    const url = new URL('/api/providers', env.NEXT_PUBLIC_APP_URL || '')
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(providerRequest),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    })

    if (!response.ok) {
      const errorMessage = await this.extractErrorMessage(response)
      throw new Error(errorMessage)
    }

    this.logExecutionSuccess(
      providerRequest.provider,
      providerRequest.model,
      context,
      block,
      providerStartTime,
      'HTTP response'
    )

    // Check if this is a streaming response
    const contentType = response.headers.get('Content-Type')
    if (contentType?.includes('text/event-stream')) {
      // Handle streaming response
      logger.info('Received streaming response')
      return this.handleStreamingResponse(response, block)
    }

    // Handle regular JSON response
    const result = await response.json()
    return this.processProviderResponse(result, block, responseFormat)
  }

  private async handleStreamingResponse(
    response: Response,
    block: SerializedBlock
  ): Promise<StreamingExecution> {
    // Check if we have execution data in headers (from StreamingExecution)
    const executionDataHeader = response.headers.get('X-Execution-Data')

    if (executionDataHeader) {
      // Parse execution data from header
      try {
        const executionData = JSON.parse(executionDataHeader)

        // Create StreamingExecution object
        return {
          stream: response.body!,
          execution: {
            success: executionData.success,
            output: executionData.output || {},
            error: executionData.error,
            logs: [], // Logs are stripped from headers, will be populated by executor
            metadata: executionData.metadata || {
              duration: 0,
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
        // Fall back to minimal streaming execution
      }
    }

    // Fallback for plain ReadableStream or when header parsing fails
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

  private async extractErrorMessage(response: Response): Promise<string> {
    let errorMessage = `Provider API request failed with status ${response.status}`
    try {
      const errorData = await response.json()
      if (errorData.error) {
        errorMessage = errorData.error
      }
    } catch (_e) {
      // Use default message if JSON parsing fails
    }
    return errorMessage
  }

  private logExecutionSuccess(
    provider: string,
    model: string,
    context: ExecutionContext,
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

    logger.info('Provider request completed successfully', {
      provider,
      model,
      workflowId: context.workflowId,
      blockId: block.id,
      executionTime,
      responseType,
    })
  }

  private handleExecutionError(
    error: any,
    startTime: number,
    provider: string,
    model: string,
    context: ExecutionContext,
    block: SerializedBlock
  ) {
    const executionTime = Date.now() - startTime

    logger.error('Error executing provider request:', {
      error,
      executionTime,
      provider,
      model,
      workflowId: context.workflowId,
      blockId: block.id,
    })

    if (!(error instanceof Error)) return

    logger.error('Provider request error details', {
      workflowId: context.workflowId,
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
    logger.info(`Received StreamingExecution for block ${block.id}`)

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
          duration: 0,
          startTime: new Date().toISOString(),
        },
      },
    }
  }

  private processRegularResponse(result: any, responseFormat: any): BlockOutput {
    logger.info('Provider response received', {
      contentLength: result.content ? result.content.length : 0,
      model: result.model,
      hasTokens: !!result.tokens,
      hasToolCalls: !!result.toolCalls,
      toolCallsCount: result.toolCalls?.length || 0,
    })

    if (responseFormat) {
      return this.processStructuredResponse(result, responseFormat)
    }

    return this.processStandardResponse(result)
  }

  private processStructuredResponse(result: any, responseFormat: any): BlockOutput {
    const content = result.content

    try {
      const extractedJson = JSON.parse(content.trim())
      logger.info('Successfully parsed structured response content')
      return {
        ...extractedJson,
        ...this.createResponseMetadata(result),
      }
    } catch (error) {
      logger.info('JSON parsing failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })

      // LLM did not adhere to structured response format
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

  private createResponseMetadata(result: any) {
    return {
      tokens: result.tokens || { prompt: 0, completion: 0, total: 0 },
      toolCalls: {
        list: result.toolCalls ? result.toolCalls.map(this.formatToolCall.bind(this)) : [],
        count: result.toolCalls?.length || 0,
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
      input: tc.arguments || tc.input || {}, // Keep both for backward compatibility
      output: tc.result || tc.output,
    }
  }

  private stripCustomToolPrefix(name: string): string {
    return name.startsWith('custom_') ? name.replace('custom_', '') : name
  }
}
