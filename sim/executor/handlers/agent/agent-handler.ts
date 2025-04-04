import { createLogger } from '@/lib/logs/console-logger'
import { getAllBlocks } from '@/blocks'
import { BlockOutput } from '@/blocks/types'
import { executeProviderRequest } from '@/providers'
import { getProviderFromModel, transformBlockTool } from '@/providers/utils'
import { SerializedBlock } from '@/serializer/types'
import { executeTool, getTool } from '@/tools'
import { BlockHandler, ExecutionContext } from '../../types'

const logger = createLogger('AgentBlockHandler')

/**
 * Handler for Agent blocks that process LLM requests with optional tools.
 */
export class AgentBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === 'agent'
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    logger.info(`Executing agent block: ${block.id}`)

    // Check for null values and try to resolve from environment variables
    const nullInputs = Object.entries(inputs)
      .filter(([_, value]) => value === null)
      .map(([key]) => key)

    // Parse response format if provided
    let responseFormat: any = undefined
    if (inputs.responseFormat) {
      // Handle empty string case - treat it as no response format
      if (inputs.responseFormat === '') {
        responseFormat = undefined
      } else {
        try {
          responseFormat =
            typeof inputs.responseFormat === 'string'
              ? JSON.parse(inputs.responseFormat)
              : inputs.responseFormat

          // Ensure the responseFormat is properly structured
          if (responseFormat && typeof responseFormat === 'object') {
            // If it's just a raw schema without the expected wrapper properties,
            // wrap it properly for the provider
            if (!responseFormat.schema && !responseFormat.name) {
              responseFormat = {
                name: 'response_schema',
                schema: responseFormat,
                strict: true,
              }
            }
          }
        } catch (error: any) {
          logger.error(`Failed to parse response format:`, { error })
          throw new Error(`Invalid response format: ${error.message}`)
        }
      }
    }

    const model = inputs.model || 'gpt-4o'
    const providerId = getProviderFromModel(model)
    logger.info(`Using provider: ${providerId}, model: ${model}`)

    // Format tools for provider API
    const formattedTools = Array.isArray(inputs.tools)
      ? (
          await Promise.all(
            inputs.tools.map(async (tool: any) => {
              // Handle custom tools
              if (tool.type === 'custom-tool' && tool.schema) {
                // Add function execution capability to custom tools with code
                if (tool.code) {
                  // Store the tool's code and make it available for execution
                  const toolName = tool.schema.function.name
                  const params = tool.params || {}

                  // Create a tool that can execute the code
                  return {
                    id: `custom_${tool.title}`,
                    name: toolName,
                    description: tool.schema.function.description || '',
                    params: params,
                    parameters: {
                      type: tool.schema.function.parameters.type,
                      properties: tool.schema.function.parameters.properties,
                      required: tool.schema.function.parameters.required || [],
                    },
                    executeFunction: async (callParams: Record<string, any>) => {
                      try {
                        // Execute the code using the function_execute tool
                        const result = await executeTool('function_execute', {
                          code: tool.code,
                          ...params,
                          ...callParams,
                          timeout: tool.timeout || 5000,
                        })

                        if (!result.success) {
                          throw new Error(result.error || 'Function execution failed')
                        }

                        return result.output
                      } catch (error: any) {
                        logger.error(`Error executing custom tool ${toolName}:`, error)
                        throw new Error(`Error in ${toolName}: ${error.message}`)
                      }
                    },
                  }
                }

                return {
                  id: `custom_${tool.title}`,
                  name: tool.schema.function.name,
                  description: tool.schema.function.description || '',
                  params: tool.params || {},
                  parameters: {
                    type: tool.schema.function.parameters.type,
                    properties: tool.schema.function.parameters.properties,
                    required: tool.schema.function.parameters.required || [],
                  },
                }
              }

              // Handle regular block tools with operation selection
              return transformBlockTool(tool, {
                selectedOperation: tool.operation,
                getAllBlocks,
                getTool,
              })
            })
          )
        ).filter((t: any): t is NonNullable<typeof t> => t !== null)
      : []

    // Debug request before sending to provider
    const providerRequest = {
      model,
      systemPrompt: inputs.systemPrompt,
      context: Array.isArray(inputs.context)
        ? JSON.stringify(inputs.context, null, 2)
        : typeof inputs.context === 'string'
          ? inputs.context
          : JSON.stringify(inputs.context, null, 2),
      tools: formattedTools.length > 0 ? formattedTools : undefined,
      temperature: inputs.temperature,
      maxTokens: inputs.maxTokens,
      apiKey: inputs.apiKey,
      responseFormat,
    }

    logger.info(`Provider request prepared`, {
      model: providerRequest.model,
      hasSystemPrompt: !!providerRequest.systemPrompt,
      hasContext: !!providerRequest.context,
      hasTools: !!providerRequest.tools,
      hasApiKey: !!providerRequest.apiKey,
    })

    // Ensure context is properly formatted for the provider
    const response = await executeProviderRequest(providerId, providerRequest)

    logger.info(`Provider response received`, {
      contentLength: response.content ? response.content.length : 0,
      model: response.model,
      hasTokens: !!response.tokens,
      hasToolCalls: !!response.toolCalls,
      toolCallsCount: response.toolCalls?.length || 0,
    })

    // If structured responses, try to parse the content
    if (responseFormat) {
      try {
        const parsedContent = JSON.parse(response.content)

        const result = {
          response: {
            ...parsedContent,
            tokens: response.tokens || {
              prompt: 0,
              completion: 0,
              total: 0,
            },
            toolCalls: response.toolCalls
              ? {
                  list: response.toolCalls.map((tc) => ({
                    ...tc,
                    // Preserve timing information if available
                    startTime: tc.startTime,
                    endTime: tc.endTime,
                    duration: tc.duration,
                    input: tc.arguments || tc.input,
                    output: tc.result || tc.output,
                  })),
                  count: response.toolCalls.length,
                }
              : undefined,
            providerTiming: response.timing || undefined,
            cost: response.cost || undefined,
          },
        }

        return result
      } catch (error) {
        logger.error(`Failed to parse response content:`, { error })
        logger.info(`Falling back to standard response format`)

        // Fall back to standard response if parsing fails
        return {
          response: {
            content: response.content,
            model: response.model,
            tokens: response.tokens || {
              prompt: 0,
              completion: 0,
              total: 0,
            },
            toolCalls: {
              list: response.toolCalls
                ? response.toolCalls.map((tc) => ({
                    ...tc,
                    // Preserve timing information if available
                    startTime: tc.startTime,
                    endTime: tc.endTime,
                    duration: tc.duration,
                    input: tc.arguments || tc.input,
                    output: tc.result || tc.output,
                  }))
                : [],
              count: response.toolCalls?.length || 0,
            },
            providerTiming: response.timing || undefined,
            cost: response.cost || undefined,
          },
        }
      }
    }

    // Return standard response if no responseFormat
    return {
      response: {
        content: response.content,
        model: response.model,
        tokens: response.tokens || {
          prompt: 0,
          completion: 0,
          total: 0,
        },
        toolCalls: {
          list: response.toolCalls
            ? response.toolCalls.map((tc) => ({
                ...tc,
                // Preserve timing information if available
                startTime: tc.startTime,
                endTime: tc.endTime,
                duration: tc.duration,
                input: tc.arguments || tc.input,
                output: tc.result || tc.output,
              }))
            : [],
          count: response.toolCalls?.length || 0,
        },
        providerTiming: response.timing || undefined,
        cost: response.cost || undefined,
      },
    }
  }
}
