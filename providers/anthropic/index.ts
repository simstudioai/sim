import Anthropic from '@anthropic-ai/sdk'
import { executeTool } from '@/tools'
import { ProviderConfig, ProviderRequest, ProviderResponse } from '../types'

export const anthropicProvider: ProviderConfig = {
  id: 'anthropic',
  name: 'Anthropic',
  description: "Anthropic's Claude models",
  version: '1.0.0',
  models: ['claude-3-7-sonnet-20250219'],
  defaultModel: 'claude-3-7-sonnet-20250219',

  executeRequest: async (request: ProviderRequest): Promise<ProviderResponse> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Anthropic')
    }

    const anthropic = new Anthropic({
      apiKey: request.apiKey,
      dangerouslyAllowBrowser: true,
    })

    // Helper function to generate a simple unique ID for tool uses
    const generateToolUseId = (toolName: string) => {
      return `${toolName}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    }

    // Transform messages to Anthropic format
    const messages = []

    // Add system prompt if present
    let systemPrompt = request.systemPrompt || ''

    // Add context if present
    if (request.context) {
      messages.push({
        role: 'user',
        content: request.context,
      })
    }

    // Add remaining messages
    if (request.messages) {
      request.messages.forEach((msg) => {
        if (msg.role === 'function') {
          messages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: msg.name,
                content: msg.content,
              },
            ],
          })
        } else if (msg.function_call) {
          const toolUseId = msg.function_call.name + '-' + Date.now()
          messages.push({
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: toolUseId,
                name: msg.function_call.name,
                input: JSON.parse(msg.function_call.arguments),
              },
            ],
          })
        } else {
          messages.push({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content ? [{ type: 'text', text: msg.content }] : [],
          })
        }
      })
    }

    // Ensure there's at least one message
    if (messages.length === 0) {
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: systemPrompt || 'Hello' }],
      })
      // Clear system prompt since we've used it as a user message
      systemPrompt = ''
    }

    // Transform tools to Anthropic format if provided
    const tools = request.tools?.length
      ? request.tools.map((tool) => ({
          name: tool.id,
          description: tool.description,
          input_schema: {
            type: 'object',
            properties: tool.parameters.properties,
            required: tool.parameters.required,
          },
        }))
      : undefined

    // If response format is specified, add strict formatting instructions
    if (request.responseFormat) {
      // Get the schema from the response format
      const schema = request.responseFormat.schema || request.responseFormat

      // Build a system prompt for structured output based on the JSON schema
      let schemaInstructions = ''

      if (schema && schema.properties) {
        // Create a template of the expected JSON structure
        const jsonTemplate = Object.entries(schema.properties).reduce(
          (acc: Record<string, any>, [key, prop]: [string, any]) => {
            let exampleValue
            const propType = prop.type || 'string'

            // Generate appropriate example values based on type
            switch (propType) {
              case 'string':
                exampleValue = '"value"'
                break
              case 'number':
                exampleValue = '0'
                break
              case 'boolean':
                exampleValue = 'true'
                break
              case 'array':
                exampleValue = '[]'
                break
              case 'object':
                exampleValue = '{}'
                break
              default:
                exampleValue = '"value"'
            }

            acc[key] = exampleValue
            return acc
          },
          {}
        )

        // Generate field descriptions
        const fieldDescriptions = Object.entries(schema.properties)
          .map(([key, prop]: [string, any]) => {
            const type = prop.type || 'string'
            const description = prop.description ? `: ${prop.description}` : ''
            return `${key} (${type})${description}`
          })
          .join('\n')

        // Format the JSON template as a string
        const jsonTemplateStr = JSON.stringify(jsonTemplate, null, 2)

        schemaInstructions = `
IMPORTANT RESPONSE FORMAT INSTRUCTIONS:
1. Your response must be EXACTLY in this format, with no additional fields:
${jsonTemplateStr}

Field descriptions:
${fieldDescriptions}

2. DO NOT include any explanatory text before or after the JSON
3. DO NOT wrap the response in an array
4. DO NOT add any fields not specified in the schema
5. Your response MUST be valid JSON and include all the specified fields with their correct types`
      }

      systemPrompt = `${systemPrompt}${schemaInstructions}`
    }

    // Build the request payload
    const payload: any = {
      model: request.model || 'claude-3-7-sonnet-20250219',
      messages,
      system: systemPrompt,
      max_tokens: parseInt(String(request.maxTokens)) || 1024,
      temperature: parseFloat(String(request.temperature ?? 0.7)),
    }

    // Add tools if provided
    if (tools?.length) {
      payload.tools = tools
    }

    // Make the initial API request
    let currentResponse = await anthropic.messages.create(payload)
    let content = ''

    // Extract text content from the message
    if (Array.isArray(currentResponse.content)) {
      content = currentResponse.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n')
    }

    let tokens = {
      prompt: currentResponse.usage?.input_tokens || 0,
      completion: currentResponse.usage?.output_tokens || 0,
      total:
        (currentResponse.usage?.input_tokens || 0) + (currentResponse.usage?.output_tokens || 0),
    }

    let toolCalls = []
    let toolResults = []
    let currentMessages = [...messages]
    let iterationCount = 0
    const MAX_ITERATIONS = 10 // Prevent infinite loops

    try {
      while (iterationCount < MAX_ITERATIONS) {
        // Check for tool calls
        const toolUses = currentResponse.content.filter((item) => item.type === 'tool_use')
        if (!toolUses || toolUses.length === 0) {
          break
        }

        // Process each tool call
        for (const toolUse of toolUses) {
          try {
            const toolName = toolUse.name
            const toolArgs = toolUse.input as Record<string, any>

            // Get the tool from the tools registry
            const tool = request.tools?.find((t) => t.id === toolName)
            if (!tool) continue

            // Execute the tool
            const mergedArgs = { ...tool.params, ...toolArgs }
            const result = await executeTool(toolName, mergedArgs)

            if (!result.success) continue

            toolResults.push(result.output)
            toolCalls.push({
              name: toolName,
              arguments: toolArgs,
            })

            // Add the tool call and result to messages
            const toolUseId = generateToolUseId(toolName)

            currentMessages.push({
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: toolUseId,
                  name: toolName,
                  input: toolArgs,
                } as any,
              ],
            })

            currentMessages.push({
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  content: JSON.stringify(result.output),
                } as any,
              ],
            })
          } catch (error) {
            console.error('Error processing tool call:', error)
          }
        }

        // Make the next request with updated messages
        const nextPayload = {
          ...payload,
          messages: currentMessages,
        }

        // Make the next request
        currentResponse = await anthropic.messages.create(nextPayload)

        // Update content if we have a text response
        const textContent = currentResponse.content
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('\n')

        if (textContent) {
          content = textContent
        }

        // Update token counts
        if (currentResponse.usage) {
          tokens.prompt += currentResponse.usage.input_tokens || 0
          tokens.completion += currentResponse.usage.output_tokens || 0
          tokens.total +=
            (currentResponse.usage.input_tokens || 0) + (currentResponse.usage.output_tokens || 0)
        }

        iterationCount++
      }
    } catch (error) {
      console.error('Error in Anthropic request:', error)
      throw error
    }

    // If the content looks like it contains JSON, extract just the JSON part
    if (content.includes('{') && content.includes('}')) {
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/m)
        if (jsonMatch) {
          content = jsonMatch[0]
        }
      } catch (e) {
        console.error('Error extracting JSON from response:', e)
      }
    }

    return {
      content,
      model: request.model || 'claude-3-7-sonnet-20250219',
      tokens,
      toolCalls:
        toolCalls.length > 0
          ? toolCalls.map((tc) => ({
              name: tc.name,
              arguments: tc.arguments as Record<string, any>,
            }))
          : undefined,
      toolResults: toolResults.length > 0 ? toolResults : undefined,
    }
  },
}
