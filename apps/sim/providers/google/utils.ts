import type { ProviderRequest } from '@/providers/types'

/**
 * Removes additionalProperties from a schema object (not supported by Gemini)
 */
export function cleanSchemaForGemini(schema: any): any {
  if (schema === null || schema === undefined) return schema
  if (typeof schema !== 'object') return schema
  if (Array.isArray(schema)) {
    return schema.map((item) => cleanSchemaForGemini(item))
  }

  const cleanedSchema: any = {}

  for (const key in schema) {
    if (key === 'additionalProperties') continue
    cleanedSchema[key] = cleanSchemaForGemini(schema[key])
  }

  return cleanedSchema
}

/**
 * Extracts text content from a Gemini response candidate, handling structured output
 */
export function extractTextContent(candidate: any): string {
  if (!candidate?.content?.parts) return ''

  if (candidate.content.parts?.length === 1 && candidate.content.parts[0].text) {
    const text = candidate.content.parts[0].text
    if (text && (text.trim().startsWith('{') || text.trim().startsWith('['))) {
      try {
        JSON.parse(text)
        return text
      } catch (_e) {
        /* Not valid JSON, continue with normal extraction */
      }
    }
  }

  return candidate.content.parts
    .filter((part: any) => part.text)
    .map((part: any) => part.text)
    .join('\n')
}

/**
 * Extracts a function call from a Gemini response candidate
 */
export function extractFunctionCall(candidate: any): { name: string; args: any } | null {
  if (!candidate?.content?.parts) return null

  for (const part of candidate.content.parts) {
    if (part.functionCall) {
      const args = part.functionCall.args || {}
      if (
        typeof part.functionCall.args === 'string' &&
        part.functionCall.args.trim().startsWith('{')
      ) {
        try {
          return { name: part.functionCall.name, args: JSON.parse(part.functionCall.args) }
        } catch (_e) {
          return { name: part.functionCall.name, args: part.functionCall.args }
        }
      }
      return { name: part.functionCall.name, args }
    }
  }

  if (candidate.content.function_call) {
    const args =
      typeof candidate.content.function_call.arguments === 'string'
        ? JSON.parse(candidate.content.function_call.arguments || '{}')
        : candidate.content.function_call.arguments || {}
    return { name: candidate.content.function_call.name, args }
  }

  return null
}

/**
 * Converts OpenAI-style request format to Gemini format
 */
export function convertToGeminiFormat(request: ProviderRequest): {
  contents: any[]
  tools: any[] | undefined
  systemInstruction: any | undefined
} {
  const contents: any[] = []
  let systemInstruction

  if (request.systemPrompt) {
    systemInstruction = { parts: [{ text: request.systemPrompt }] }
  }

  if (request.context) {
    contents.push({ role: 'user', parts: [{ text: request.context }] })
  }

  if (request.messages && request.messages.length > 0) {
    for (const message of request.messages) {
      if (message.role === 'system') {
        if (!systemInstruction) {
          systemInstruction = { parts: [{ text: message.content }] }
        } else {
          systemInstruction.parts[0].text = `${systemInstruction.parts[0].text || ''}\n${message.content}`
        }
      } else if (message.role === 'user' || message.role === 'assistant') {
        const geminiRole = message.role === 'user' ? 'user' : 'model'

        if (message.content) {
          contents.push({ role: geminiRole, parts: [{ text: message.content }] })
        }

        if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
          const functionCalls = message.tool_calls.map((toolCall) => ({
            functionCall: {
              name: toolCall.function?.name,
              args: JSON.parse(toolCall.function?.arguments || '{}'),
            },
          }))

          contents.push({ role: 'model', parts: functionCalls })
        }
      } else if (message.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [{ text: `Function result: ${message.content}` }],
        })
      }
    }
  }

  const tools = request.tools?.map((tool) => {
    const toolParameters = { ...(tool.parameters || {}) }

    if (toolParameters.properties) {
      const properties = { ...toolParameters.properties }
      const required = toolParameters.required ? [...toolParameters.required] : []

      for (const key in properties) {
        const prop = properties[key] as any

        if (prop.default !== undefined) {
          const { default: _, ...cleanProp } = prop
          properties[key] = cleanProp
        }
      }

      const parameters = {
        type: toolParameters.type || 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
      }

      return {
        name: tool.id,
        description: tool.description || `Execute the ${tool.id} function`,
        parameters: cleanSchemaForGemini(parameters),
      }
    }

    return {
      name: tool.id,
      description: tool.description || `Execute the ${tool.id} function`,
      parameters: cleanSchemaForGemini(toolParameters),
    }
  })

  return { contents, tools, systemInstruction }
}
