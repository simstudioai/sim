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
import { toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { buildGeminiMessageParts } from '@/providers/attachments'
import type { AgentStreamEvent } from '@/providers/stream-events'
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
  if (isRecordLike(value)) {
    return value
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
export function convertToGeminiFormat(
  request: ProviderRequest,
  providerId = 'google'
): {
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
        const parts = buildGeminiMessageParts(message.content, message.files, providerId) as Part[]

        if (parts.length > 0) {
          contents.push({ role: geminiRole, parts })
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
 * Creates an agent-events-v1 stream from a Google Gemini streaming response.
 * Thought parts (`part.thought === true`) → thinking_delta; other text → text_delta.
 * Capability-honest: thinking only appears when includeThoughts was requested.
 */
export function createReadableStreamFromGeminiStream(
  stream: AsyncGenerator<GenerateContentResponse>,
  onComplete?: (content: string, usage: GeminiUsage, thinking?: string) => void
): ReadableStream<AgentStreamEvent> {
  let fullContent = ''
  let fullThinking = ''
  let usage: GeminiUsage = { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 }
  let cancelled = false
  let streamIterator: AsyncIterator<GenerateContentResponse> | undefined

  return new ReadableStream({
    async start(controller) {
      try {
        streamIterator = stream[Symbol.asyncIterator]()
        while (true) {
          const next = await streamIterator.next()
          if (next.done || cancelled) break
          const chunk = next.value
          if (chunk.promptFeedback?.blockReason) {
            throw new Error(
              `Gemini prompt blocked: ${chunk.promptFeedback.blockReason}${
                chunk.promptFeedback.blockReasonMessage
                  ? ` (${chunk.promptFeedback.blockReasonMessage})`
                  : ''
              }`
            )
          }
          if (chunk.usageMetadata) {
            usage = convertUsageMetadata(chunk.usageMetadata)
          }

          const parts = chunk.candidates?.[0]?.content?.parts
          if (Array.isArray(parts)) {
            for (const part of parts) {
              if (!part.text) continue
              if (part.thought === true) {
                fullThinking += part.text
                controller.enqueue({ type: 'thinking_delta', text: part.text })
              } else {
                fullContent += part.text
                controller.enqueue({ type: 'text_delta', text: part.text, turn: 'final' })
              }
            }
            continue
          }

          // Fallback when parts are not exposed — answer text only (no false thinking).
          const text = chunk.text
          if (text) {
            fullContent += text
            controller.enqueue({ type: 'text_delta', text, turn: 'final' })
          }
        }

        if (cancelled) return
        onComplete?.(fullContent, usage, fullThinking || undefined)
        controller.close()
      } catch (error) {
        if (!cancelled) {
          logger.error('Error reading Google Gemini stream', {
            error: toError(error).message,
          })
          controller.error(error)
        }
      }
    },
    async cancel() {
      cancelled = true
      await streamIterator?.return?.()
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
 * Per-model thinkingBudget ranges for Gemini 2.5-series models. Unlike Gemini 3.x, these
 * models reject `thinkingLevel` entirely (Gemini API docs: "Gemini 2.5 series models don't
 * support thinkingLevel; use thinkingBudget instead") and require a numeric token budget
 * within each model's own documented range.
 */
const GEMINI_25_THINKING_BUDGETS: Record<string, Record<string, number>> = {
  'gemini-2.5-pro': { low: 2048, medium: 8192, high: 32768 }, // valid range 128-32768, cannot disable
  'gemini-2.5-flash': { low: 2048, medium: 8192, high: 24576 }, // valid range 0-24576
  'gemini-2.5-flash-lite': { low: 1024, medium: 8192, high: 24576 }, // valid range 512-24576
}

/**
 * Maps a named thinking level to a `thinkingBudget` token count for Gemini 2.5-series models.
 * Falls back to -1 (dynamic/automatic budget) for any model not in the explicit table above,
 * rather than guessing a number that could fall outside an unmapped model's valid range.
 */
export function mapToThinkingBudget(model: string, level: string): number {
  const normalized = model.toLowerCase().replace(/^vertex\//, '')
  const budgets = GEMINI_25_THINKING_BUDGETS[normalized]
  if (!budgets) return -1
  return budgets[level.toLowerCase()] ?? budgets.high
}

/**
 * Gemini 2.5-series models that accept `thinkingBudget: 0` to explicitly disable thinking.
 * gemini-2.5-pro cannot disable thinking at all (its documented budget floor is 128, not 0),
 * so it's deliberately excluded here.
 */
const GEMINI_25_MODELS_SUPPORTING_DISABLE = new Set(['gemini-2.5-flash', 'gemini-2.5-flash-lite'])

/**
 * Whether this Gemini 2.5-series model supports explicitly disabling thinking via budget=0.
 * Omitting thinkingConfig entirely (the 'none' no-op path) falls back to the API's own
 * dynamic default, which is ON for gemini-2.5-flash — not the same as actually disabling it.
 */
export function supportsDisablingGemini25Thinking(model: string): boolean {
  const normalized = model.toLowerCase().replace(/^vertex\//, '')
  return GEMINI_25_MODELS_SUPPORTING_DISABLE.has(normalized)
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
