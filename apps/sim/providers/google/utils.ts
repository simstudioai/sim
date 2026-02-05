import {
  type Candidate,
  type Content,
  type FunctionCall,
  FunctionCallingConfigMode,
  type GenerateContentResponse,
  type GenerateContentResponseUsageMetadata,
  type Part,
  type Schema,
  type SchemaUnion,
  ThinkingLevel,
  type ToolConfig,
  Type,
} from '@google/genai'
import { createLogger } from '@sim/logger'
import type { ProviderRequest } from '@/providers/types'
import { trackForcedToolUsage } from '@/providers/utils'

const logger = createLogger('GoogleUtils')

/**
 * Ensures a value is a valid object for Gemini's functionResponse.response field.
 * Gemini's API requires functionResponse.response to be a google.protobuf.Struct,
 * which must be an object with string keys. Primitive values (boolean, string,
 * number, null) and arrays are wrapped in { value: ... }.
 *
 * @param value - The value to ensure is a Struct-compatible object
 * @returns A Record<string, unknown> suitable for functionResponse.response
 */
export function ensureStructResponse(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return { value }
}

/**
 * Usage metadata for Google Gemini responses
 */
export interface GeminiUsage {
  promptTokenCount: number
  candidatesTokenCount: number
  totalTokenCount: number
}

/**
 * Parsed function call from Gemini response
 */
export interface ParsedFunctionCall {
  name: string
  args: Record<string, unknown>
}

/**
 * Removes additionalProperties from a schema object (not supported by Gemini)
 */
export function cleanSchemaForGemini(schema: SchemaUnion): SchemaUnion {
  if (schema === null || schema === undefined) return schema
  if (typeof schema !== 'object') return schema
  if (Array.isArray(schema)) {
    return schema.map((item) => cleanSchemaForGemini(item))
  }

  const cleanedSchema: Record<string, unknown> = {}
  const schemaObj = schema as Record<string, unknown>

  for (const key in schemaObj) {
    if (key === 'additionalProperties') continue
    cleanedSchema[key] = cleanSchemaForGemini(schemaObj[key] as SchemaUnion)
  }

  return cleanedSchema
}

/**
 * Extracts text content from a Gemini response candidate.
 * Filters out thought parts (model reasoning) from the output.
 */
export function extractTextContent(candidate: Candidate | undefined): string {
  if (!candidate?.content?.parts) return ''

  const textParts = candidate.content.parts.filter(
    (part): part is Part & { text: string } => Boolean(part.text) && part.thought !== true
  )

  if (textParts.length === 0) return ''
  if (textParts.length === 1) return textParts[0].text

  return textParts.map((part) => part.text).join('\n')
}

/**
 * Extracts the first function call from a Gemini response candidate
 */
export function extractFunctionCall(candidate: Candidate | undefined): ParsedFunctionCall | null {
  if (!candidate?.content?.parts) return null

  for (const part of candidate.content.parts) {
    if (part.functionCall) {
      return {
        name: part.functionCall.name ?? '',
        args: (part.functionCall.args ?? {}) as Record<string, unknown>,
      }
    }
  }

  return null
}

/**
 * Extracts the full Part containing the function call (preserves thoughtSignature)
 * @deprecated Use extractAllFunctionCallParts for proper multi-tool handling
 */
export function extractFunctionCallPart(candidate: Candidate | undefined): Part | null {
  if (!candidate?.content?.parts) return null

  for (const part of candidate.content.parts) {
    if (part.functionCall) {
      return part
    }
  }

  return null
}

/**
 * Extracts ALL Parts containing function calls from a candidate.
 * Gemini can return multiple function calls in a single response,
 * and all should be executed before continuing the conversation.
 */
export function extractAllFunctionCallParts(candidate: Candidate | undefined): Part[] {
  if (!candidate?.content?.parts) return []

  return candidate.content.parts.filter((part) => part.functionCall)
}

/**
 * Converts usage metadata from SDK response to our format.
 * Per Gemini docs, total = promptTokenCount + candidatesTokenCount + toolUsePromptTokenCount + thoughtsTokenCount
 * We include toolUsePromptTokenCount in input and thoughtsTokenCount in output for correct billing.
 */
export function convertUsageMetadata(
  usageMetadata: GenerateContentResponseUsageMetadata | undefined
): GeminiUsage {
  const thoughtsTokenCount = usageMetadata?.thoughtsTokenCount ?? 0
  const toolUsePromptTokenCount = usageMetadata?.toolUsePromptTokenCount ?? 0
  const promptTokenCount = (usageMetadata?.promptTokenCount ?? 0) + toolUsePromptTokenCount
  const candidatesTokenCount = (usageMetadata?.candidatesTokenCount ?? 0) + thoughtsTokenCount
  return {
    promptTokenCount,
    candidatesTokenCount,
    totalTokenCount: usageMetadata?.totalTokenCount ?? 0,
  }
}

/**
 * Tool definition for Gemini format
 */
export interface GeminiToolDef {
  name: string
  description: string
  parameters: Schema
}

/**
 * Converts OpenAI-style request format to Gemini format
 */
export function convertToGeminiFormat(request: ProviderRequest): {
  contents: Content[]
  tools: GeminiToolDef[] | undefined
  systemInstruction: Content | undefined
} {
  const contents: Content[] = []
  let systemInstruction: Content | undefined

  if (request.systemPrompt) {
    systemInstruction = { parts: [{ text: request.systemPrompt }] }
  }

  if (request.context) {
    contents.push({ role: 'user', parts: [{ text: request.context }] })
  }

  if (request.messages?.length) {
    for (const message of request.messages) {
      if (message.role === 'system') {
        if (!systemInstruction) {
          systemInstruction = { parts: [{ text: message.content ?? '' }] }
        } else if (systemInstruction.parts?.[0] && 'text' in systemInstruction.parts[0]) {
          systemInstruction.parts[0].text = `${systemInstruction.parts[0].text}\n${message.content}`
        }
      } else if (message.role === 'user' || message.role === 'assistant') {
        const geminiRole = message.role === 'user' ? 'user' : 'model'

        if (message.content) {
          contents.push({ role: geminiRole, parts: [{ text: message.content }] })
        }

        if (message.role === 'assistant' && message.tool_calls?.length) {
          const functionCalls = message.tool_calls.map((toolCall) => ({
            functionCall: {
              name: toolCall.function?.name,
              args: JSON.parse(toolCall.function?.arguments || '{}') as Record<string, unknown>,
            },
          }))
          contents.push({ role: 'model', parts: functionCalls })
        }
      } else if (message.role === 'tool') {
        if (!message.name) {
          logger.warn('Tool message missing function name, skipping')
          continue
        }
        let responseData: Record<string, unknown>
        try {
          const parsed = JSON.parse(message.content ?? '{}')
          responseData = ensureStructResponse(parsed)
        } catch {
          responseData = { output: message.content }
        }
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: message.tool_call_id,
                name: message.name,
                response: responseData,
              },
            },
          ],
        })
      }
    }
  }

  const tools = request.tools?.map((tool): GeminiToolDef => {
    const toolParameters = { ...(tool.parameters || {}) }

    if (toolParameters.properties) {
      const properties = { ...toolParameters.properties }
      const required = toolParameters.required ? [...toolParameters.required] : []

      // Remove default values from properties (not supported by Gemini)
      for (const key in properties) {
        const prop = properties[key] as Record<string, unknown>
        if (prop.default !== undefined) {
          const { default: _, ...cleanProp } = prop
          properties[key] = cleanProp
        }
      }

      const parameters: Schema = {
        type: (toolParameters.type as Schema['type']) || Type.OBJECT,
        properties: properties as Record<string, Schema>,
        ...(required.length > 0 ? { required } : {}),
      }

      return {
        name: tool.id,
        description: tool.description || `Execute the ${tool.id} function`,
        parameters: cleanSchemaForGemini(parameters) as Schema,
      }
    }

    return {
      name: tool.id,
      description: tool.description || `Execute the ${tool.id} function`,
      parameters: cleanSchemaForGemini(toolParameters) as Schema,
    }
  })

  return { contents, tools, systemInstruction }
}

/**
 * Creates a ReadableStream from a Google Gemini streaming response
 */
export function createReadableStreamFromGeminiStream(
  stream: AsyncGenerator<GenerateContentResponse>,
  onComplete?: (content: string, usage: GeminiUsage) => void
): ReadableStream<Uint8Array> {
  let fullContent = ''
  let usage: GeminiUsage = { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 }

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (chunk.usageMetadata) {
            usage = convertUsageMetadata(chunk.usageMetadata)
          }

          const text = chunk.text
          if (text) {
            fullContent += text
            controller.enqueue(new TextEncoder().encode(text))
          }
        }

        onComplete?.(fullContent, usage)
        controller.close()
      } catch (error) {
        logger.error('Error reading Google Gemini stream', {
          error: error instanceof Error ? error.message : String(error),
        })
        controller.error(error)
      }
    },
  })
}

/**
 * Maps string mode to FunctionCallingConfigMode enum
 */
function mapToFunctionCallingMode(mode: string): FunctionCallingConfigMode {
  switch (mode) {
    case 'AUTO':
      return FunctionCallingConfigMode.AUTO
    case 'ANY':
      return FunctionCallingConfigMode.ANY
    case 'NONE':
      return FunctionCallingConfigMode.NONE
    default:
      return FunctionCallingConfigMode.AUTO
  }
}

/**
 * Maps string level to ThinkingLevel enum
 */
export function mapToThinkingLevel(level: string): ThinkingLevel {
  switch (level.toLowerCase()) {
    case 'minimal':
      return ThinkingLevel.MINIMAL
    case 'low':
      return ThinkingLevel.LOW
    case 'medium':
      return ThinkingLevel.MEDIUM
    case 'high':
      return ThinkingLevel.HIGH
    default:
      return ThinkingLevel.HIGH
  }
}

/**
 * Result of checking forced tool usage
 */
export interface ForcedToolResult {
  hasUsedForcedTool: boolean
  usedForcedTools: string[]
  nextToolConfig: ToolConfig | undefined
}

/**
 * Checks for forced tool usage in Google Gemini responses
 */
export function checkForForcedToolUsage(
  functionCalls: FunctionCall[] | undefined,
  toolConfig: ToolConfig | undefined,
  forcedTools: string[],
  usedForcedTools: string[]
): ForcedToolResult | null {
  if (!functionCalls?.length) return null

  const adaptedToolCalls = functionCalls.map((fc) => ({
    name: fc.name ?? '',
    arguments: (fc.args ?? {}) as Record<string, unknown>,
  }))

  const result = trackForcedToolUsage(
    adaptedToolCalls,
    toolConfig,
    logger,
    'google',
    forcedTools,
    usedForcedTools
  )

  if (!result) return null

  const nextToolConfig: ToolConfig | undefined = result.nextToolConfig?.functionCallingConfig?.mode
    ? {
        functionCallingConfig: {
          mode: mapToFunctionCallingMode(result.nextToolConfig.functionCallingConfig.mode),
          allowedFunctionNames: result.nextToolConfig.functionCallingConfig.allowedFunctionNames,
        },
      }
    : undefined

  return {
    hasUsedForcedTool: result.hasUsedForcedTool,
    usedForcedTools: result.usedForcedTools,
    nextToolConfig,
  }
}
