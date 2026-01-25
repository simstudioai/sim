import type {
  RawMessageDeltaEvent,
  RawMessageStartEvent,
  RawMessageStreamEvent,
  Usage,
} from '@anthropic-ai/sdk/resources'
import { createLogger } from '@sim/logger'
import { trackForcedToolUsage } from '@/providers/utils'

const logger = createLogger('AnthropicUtils')

/**
 * Supported string formats for Anthropic structured outputs.
 * @see https://platform.claude.com/docs/en/build-with-claude/structured-outputs
 */
const SUPPORTED_STRING_FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
])

/**
 * Removes a key from an object and returns its value.
 */
function pop<T extends Record<string, unknown>, K extends keyof T>(obj: T, key: K): T[K] {
  const value = obj[key]
  delete obj[key]
  return value
}

/**
 * Transforms a JSON schema to be compatible with Anthropic's structured outputs.
 *
 * This function is adapted from the official Anthropic SDK (MIT licensed).
 * @see https://github.com/anthropics/anthropic-sdk-typescript
 *
 * It performs the following transformations:
 * - Adds `additionalProperties: false` to ALL object types (required by Anthropic)
 * - Removes unsupported JSON Schema constraints (minimum, maximum, minLength, etc.)
 * - Filters string formats to only supported ones
 * - Moves unsupported constraints to description for model guidance
 */
export function transformJSONSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
  const workingCopy = JSON.parse(JSON.stringify(jsonSchema))
  return _transformJSONSchema(workingCopy)
}

function _transformJSONSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
  const strictSchema: Record<string, unknown> = {}

  const ref = pop(jsonSchema, '$ref')
  if (ref !== undefined) {
    strictSchema.$ref = ref
    return strictSchema
  }

  const defs = pop(jsonSchema, '$defs') as Record<string, Record<string, unknown>> | undefined
  if (defs !== undefined) {
    const strictDefs: Record<string, unknown> = {}
    strictSchema.$defs = strictDefs
    for (const [name, defSchema] of Object.entries(defs)) {
      strictDefs[name] = _transformJSONSchema(defSchema)
    }
  }

  const type = pop(jsonSchema, 'type')
  const anyOf = pop(jsonSchema, 'anyOf') as Record<string, unknown>[] | undefined
  const oneOf = pop(jsonSchema, 'oneOf') as Record<string, unknown>[] | undefined
  const allOf = pop(jsonSchema, 'allOf') as Record<string, unknown>[] | undefined

  if (Array.isArray(anyOf)) {
    strictSchema.anyOf = anyOf.map((variant) => _transformJSONSchema(variant))
  } else if (Array.isArray(oneOf)) {
    strictSchema.anyOf = oneOf.map((variant) => _transformJSONSchema(variant))
  } else if (Array.isArray(allOf)) {
    strictSchema.allOf = allOf.map((entry) => _transformJSONSchema(entry))
  } else {
    if (type === undefined) {
      throw new Error('JSON schema must have a type defined if anyOf/oneOf/allOf are not used')
    }
    strictSchema.type = type
  }

  const description = pop(jsonSchema, 'description')
  if (description !== undefined) {
    strictSchema.description = description
  }

  const title = pop(jsonSchema, 'title')
  if (title !== undefined) {
    strictSchema.title = title
  }

  if (type === 'object') {
    const properties = (pop(jsonSchema, 'properties') || {}) as Record<
      string,
      Record<string, unknown>
    >
    strictSchema.properties = Object.fromEntries(
      Object.entries(properties).map(([key, propSchema]) => [key, _transformJSONSchema(propSchema)])
    )
    pop(jsonSchema, 'additionalProperties')
    strictSchema.additionalProperties = false

    const required = pop(jsonSchema, 'required')
    if (required !== undefined) {
      strictSchema.required = required
    }
  } else if (type === 'string') {
    const format = pop(jsonSchema, 'format') as string | undefined
    if (format !== undefined && SUPPORTED_STRING_FORMATS.has(format)) {
      strictSchema.format = format
    } else if (format !== undefined) {
      jsonSchema.format = format
    }

    const enumValues = pop(jsonSchema, 'enum')
    if (enumValues !== undefined) {
      strictSchema.enum = enumValues
    }

    const constValue = pop(jsonSchema, 'const')
    if (constValue !== undefined) {
      strictSchema.const = constValue
    }
  } else if (type === 'array') {
    const items = pop(jsonSchema, 'items') as Record<string, unknown> | undefined
    if (items !== undefined) {
      strictSchema.items = _transformJSONSchema(items)
    }

    const minItems = pop(jsonSchema, 'minItems') as number | undefined
    if (minItems !== undefined && (minItems === 0 || minItems === 1)) {
      strictSchema.minItems = minItems
    } else if (minItems !== undefined) {
      jsonSchema.minItems = minItems
    }
  } else if (type === 'number' || type === 'integer') {
    const enumValues = pop(jsonSchema, 'enum')
    if (enumValues !== undefined) {
      strictSchema.enum = enumValues
    }

    const constValue = pop(jsonSchema, 'const')
    if (constValue !== undefined) {
      strictSchema.const = constValue
    }
  } else if (type === 'boolean') {
    const constValue = pop(jsonSchema, 'const')
    if (constValue !== undefined) {
      strictSchema.const = constValue
    }
  }

  if (Object.keys(jsonSchema).length > 0) {
    const existingDescription = strictSchema.description as string | undefined
    strictSchema.description =
      (existingDescription ? `${existingDescription}\n\n` : '') +
      '{' +
      Object.entries(jsonSchema)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join(', ') +
      '}'
  }

  return strictSchema
}

export interface AnthropicStreamUsage {
  input_tokens: number
  output_tokens: number
}

export function createReadableStreamFromAnthropicStream(
  anthropicStream: AsyncIterable<RawMessageStreamEvent>,
  onComplete?: (content: string, usage: AnthropicStreamUsage) => void
): ReadableStream<Uint8Array> {
  let fullContent = ''
  let inputTokens = 0
  let outputTokens = 0

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of anthropicStream) {
          if (event.type === 'message_start') {
            const startEvent = event as RawMessageStartEvent
            const usage: Usage = startEvent.message.usage
            inputTokens = usage.input_tokens
          } else if (event.type === 'message_delta') {
            const deltaEvent = event as RawMessageDeltaEvent
            outputTokens = deltaEvent.usage.output_tokens
          } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            const text = event.delta.text
            fullContent += text
            controller.enqueue(new TextEncoder().encode(text))
          }
        }

        if (onComplete) {
          onComplete(fullContent, { input_tokens: inputTokens, output_tokens: outputTokens })
        }

        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })
}

export function generateToolUseId(toolName: string): string {
  return `${toolName}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
}

export function checkForForcedToolUsage(
  response: any,
  toolChoice: any,
  forcedTools: string[],
  usedForcedTools: string[]
): { hasUsedForcedTool: boolean; usedForcedTools: string[] } | null {
  if (typeof toolChoice === 'object' && toolChoice !== null && Array.isArray(response.content)) {
    const toolUses = response.content.filter((item: any) => item.type === 'tool_use')

    if (toolUses.length > 0) {
      const adaptedToolCalls = toolUses.map((tool: any) => ({ name: tool.name }))
      const adaptedToolChoice =
        toolChoice.type === 'tool' ? { function: { name: toolChoice.name } } : toolChoice

      return trackForcedToolUsage(
        adaptedToolCalls,
        adaptedToolChoice,
        logger,
        'anthropic',
        forcedTools,
        usedForcedTools
      )
    }
  }
  return null
}
