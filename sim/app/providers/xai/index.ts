import OpenAI from 'openai'
import { createLogger } from '@/lib/logs/console-logger'
import { executeTool } from '@/tools'
import { ProviderConfig, ProviderRequest, ProviderResponse } from '../types'

const logger = createLogger('XAI Provider')

export const xAIProvider: ProviderConfig = {
  id: 'xai',
  name: 'xAI',
  description: "xAI's Grok models",
  version: '1.0.0',
  models: ['grok-2-latest'],
  defaultModel: 'grok-2-latest',

  executeRequest: async (request: ProviderRequest): Promise<ProviderResponse> => {
    if (!request.apiKey) {
      throw new Error('API key is required for xAI')
    }

    const xai = new OpenAI({
      apiKey: request.apiKey,
      baseURL: 'https://api.x.ai/v1',
      dangerouslyAllowBrowser: true,
    })

    const allMessages = []

    if (request.systemPrompt) {
      allMessages.push({
        role: 'system',
        content: request.systemPrompt,
      })
    }

    if (request.context) {
      allMessages.push({
        role: 'user',
        content: request.context,
      })
    }

    if (request.messages) {
      allMessages.push(...request.messages)
    }

    const tools = request.tools?.length
      ? request.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.id,
            description: tool.description,
            parameters: tool.parameters,
          },
        }))
      : undefined

    const payload: any = {
      model: request.model || 'grok-2-latest',
      messages: allMessages,
    }

    if (request.temperature !== undefined) payload.temperature = request.temperature
    if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens

    if (request.responseFormat) {
      payload.response_format = {
        type: 'json_schema',
        json_schema: {
          name: request.responseFormat.name || 'structured_response',
          schema: request.responseFormat.schema || request.responseFormat,
          strict: request.responseFormat.strict !== false,
        },
      }

      if (allMessages.length > 0 && allMessages[0].role === 'system') {
        allMessages[0].content = `${allMessages[0].content}\n\nYou MUST respond with a valid JSON object. DO NOT include any other text, explanations, or markdown formatting in your response - ONLY the JSON object.`
      } else {
        allMessages.unshift({
          role: 'system',
          content: `You MUST respond with a valid JSON object. DO NOT include any other text, explanations, or markdown formatting in your response - ONLY the JSON object.`,
        })
      }
    }

    if (tools?.length) {
      payload.tools = tools
      payload.tool_choice = 'auto'
    }

    let currentResponse = await xai.chat.completions.create(payload)
    let content = currentResponse.choices[0]?.message?.content || ''
    let tokens = {
      prompt: currentResponse.usage?.prompt_tokens || 0,
      completion: currentResponse.usage?.completion_tokens || 0,
      total: currentResponse.usage?.total_tokens || 0,
    }
    let toolCalls = []
    let toolResults = []
    let currentMessages = [...allMessages]
    let iterationCount = 0
    const MAX_ITERATIONS = 10

    try {
      while (iterationCount < MAX_ITERATIONS) {
        const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls
        if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
          break
        }

        for (const toolCall of toolCallsInResponse) {
          try {
            const toolName = toolCall.function.name
            const toolArgs = JSON.parse(toolCall.function.arguments)

            const tool = request.tools?.find((t) => t.id === toolName)
            if (!tool) continue

            const mergedArgs = { ...tool.params, ...toolArgs }
            const result = await executeTool(toolName, mergedArgs)

            if (!result.success) continue

            toolResults.push(result.output)
            toolCalls.push({
              name: toolName,
              arguments: toolArgs,
              startTime: result.timing?.startTime,
              endTime: result.timing?.endTime,
              duration: result.timing?.duration,
              result: result.output,
            })

            currentMessages.push({
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: toolCall.id,
                  type: 'function',
                  function: {
                    name: toolName,
                    arguments: toolCall.function.arguments,
                  },
                },
              ],
            })

            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result.output),
            })
          } catch (error) {
            logger.error('Error processing tool call:', { error })
          }
        }

        const nextPayload = {
          ...payload,
          messages: currentMessages,
        }

        currentResponse = await xai.chat.completions.create(nextPayload)

        if (currentResponse.choices[0]?.message?.content) {
          content = currentResponse.choices[0].message.content
        }

        if (currentResponse.usage) {
          tokens.prompt += currentResponse.usage.prompt_tokens || 0
          tokens.completion += currentResponse.usage.completion_tokens || 0
          tokens.total += currentResponse.usage.total_tokens || 0
        }

        iterationCount++
      }
    } catch (error) {
      logger.error('Error in xAI request:', { error })
      throw error
    }

    return {
      content,
      model: request.model,
      tokens,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      toolResults: toolResults.length > 0 ? toolResults : undefined,
    }
  },
}
