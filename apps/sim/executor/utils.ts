import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { formatInternalOutputSelector } from '@/lib/workflows/streaming/output-selector'
import type { ResponseFormatStreamProcessor } from '@/executor/types'
import type { AgentStreamSink, UnsubscribeAgentStreamSink } from '@/providers/stream-events'

const logger = createLogger('ExecutorUtils')

type AgentStreamSubscribe = (sink: AgentStreamSink) => UnsubscribeAgentStreamSink

interface JsonStringToken {
  end: number
  rawValue: string
}

function selectedFieldsForBlock(blockId: string, selectedOutputs: string[]): string[] {
  const prefix = `${formatInternalOutputSelector(blockId)}_`
  return selectedOutputs
    .filter((outputId) => outputId.startsWith(prefix))
    .map((outputId) => outputId.slice(prefix.length))
}

function readJsonStringToken(input: string, start: number): JsonStringToken | null {
  if (input[start] !== '"') return null

  let escaped = false
  for (let index = start + 1; index < input.length; index++) {
    const char = input[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      return { end: index + 1, rawValue: input.slice(start + 1, index) }
    }
  }

  return null
}

function skipWhitespace(input: string, start: number): number {
  let index = start
  while (index < input.length && ' \n\r\t'.includes(input[index])) index++
  return index
}

function findJsonValueEnd(input: string, start: number): number | null {
  const first = input[start]
  if (first === '"') return readJsonStringToken(input, start)?.end ?? null

  if (first === '{' || first === '[') {
    const closingTokens = [first === '{' ? '}' : ']']
    let inString = false
    let escaped = false

    for (let index = start + 1; index < input.length; index++) {
      const char = input[index]
      if (inString) {
        if (escaped) {
          escaped = false
        } else if (char === '\\') {
          escaped = true
        } else if (char === '"') {
          inString = false
        }
        continue
      }

      if (char === '"') {
        inString = true
      } else if (char === '{') {
        closingTokens.push('}')
      } else if (char === '[') {
        closingTokens.push(']')
      } else if (char === '}' || char === ']') {
        if (closingTokens.at(-1) !== char) return null
        closingTokens.pop()
        if (closingTokens.length === 0) return index + 1
      }
    }

    return null
  }

  for (let index = start; index < input.length; index++) {
    if (input[index] === ',' || input[index] === '}') return index
  }
  return null
}

function locateTopLevelStringField(input: string, field: string): string | null {
  let index = skipWhitespace(input, 0)
  if (input[index] !== '{') return null
  index++
  let firstProperty = true

  while (index < input.length) {
    index = skipWhitespace(input, index)
    if (input[index] === '}') return null
    if (!firstProperty) {
      if (input[index] !== ',') return null
      index = skipWhitespace(input, index + 1)
    } else if (input[index] === ',') {
      return null
    }

    const keyStart = index
    const keyToken = readJsonStringToken(input, keyStart)
    if (!keyToken) return null

    let key: unknown
    try {
      key = JSON.parse(input.slice(keyStart, keyToken.end))
    } catch {
      return null
    }

    index = skipWhitespace(input, keyToken.end)
    if (input[index] !== ':') return null
    index = skipWhitespace(input, index + 1)
    if (index >= input.length) return null

    if (key === field) {
      if (input[index] !== '"') return null
      return readJsonStringToken(input, index)?.rawValue ?? input.slice(index + 1)
    }

    const valueEnd = findJsonValueEnd(input, index)
    if (valueEnd === null) return null
    index = valueEnd
    firstProperty = false
  }

  return null
}

function stableJsonStringPrefixLength(rawValue: string): number {
  let index = 0
  while (index < rawValue.length) {
    if (rawValue[index] !== '\\') {
      index++
      continue
    }

    const escapeStart = index
    if (index + 1 >= rawValue.length) return escapeStart
    const escapeType = rawValue[index + 1]
    if (escapeType !== 'u') {
      if (!'"\\/bfnrt'.includes(escapeType)) return escapeStart
      index += 2
      continue
    }

    if (index + 6 > rawValue.length) return escapeStart
    const encodedCode = rawValue.slice(index + 2, index + 6)
    if (!/^[0-9a-fA-F]{4}$/.test(encodedCode)) return escapeStart
    const code = Number.parseInt(encodedCode, 16)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 12 > rawValue.length || rawValue.slice(index + 6, index + 8) !== '\\u') {
        return escapeStart
      }
      const encodedLow = rawValue.slice(index + 8, index + 12)
      if (!/^[0-9a-fA-F]{4}$/.test(encodedLow)) return escapeStart
      const low = Number.parseInt(encodedLow, 16)
      if (low < 0xdc00 || low > 0xdfff) return escapeStart
      index += 12
      continue
    }

    index += 6
  }

  return index
}

function decodeStableJsonStringPrefix(rawValue: string): string | null {
  const stablePrefix = rawValue.slice(0, stableJsonStringPrefixLength(rawValue))
  try {
    return JSON.parse(`"${stablePrefix}"`)
  } catch {
    return null
  }
}

function declaresTopLevelStringField(responseFormat: unknown, field: string): boolean {
  if (field.includes('.')) return false

  let parsed = responseFormat
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return false
    }
  }
  if (!isRecordLike(parsed)) return false

  const schema = isRecordLike(parsed.schema) ? parsed.schema : parsed
  if (!isRecordLike(schema.properties)) return false
  const fieldSchema = schema.properties[field]
  return isRecordLike(fieldSchema) && fieldSchema.type === 'string'
}

class IncrementalJsonStringFieldProjector {
  private buffer = ''
  private emittedValue = ''

  constructor(private readonly field: string) {}

  push(chunk: string): string {
    this.buffer += chunk
    const rawValue = locateTopLevelStringField(this.buffer, this.field)
    if (rawValue === null) return ''

    const decodedValue = decodeStableJsonStringPrefix(rawValue)
    if (decodedValue === null) return ''
    if (!decodedValue.startsWith(this.emittedValue)) {
      throw new Error(`Structured stream field changed after emission: ${this.field}`)
    }

    const delta = decodedValue.slice(this.emittedValue.length)
    this.emittedValue = decodedValue
    return delta
  }

  reset(): void {
    this.buffer = ''
    this.emittedValue = ''
  }
}

/**
 * Processes a streaming response to extract only the selected response format fields
 * instead of streaming the full JSON wrapper.
 */
export class StreamingResponseFormatProcessor implements ResponseFormatStreamProcessor {
  processStream(
    originalStream: ReadableStream,
    blockId: string,
    selectedOutputs: string[],
    responseFormat?: any
  ): ReadableStream {
    const selectedFields = selectedFieldsForBlock(blockId, selectedOutputs)
    if (selectedFields.length === 0 || !responseFormat) {
      return originalStream
    }

    logger.info('Processing streaming response format', {
      blockId,
      selectedFields,
      hasResponseFormat: !!responseFormat,
      selectedFieldsCount: selectedFields.length,
    })

    return this.createProcessedStream(originalStream, selectedFields, blockId)
  }

  processEventSubscription(
    originalSubscribe: AgentStreamSubscribe,
    blockId: string,
    selectedOutputs: string[],
    responseFormat?: unknown
  ): AgentStreamSubscribe | undefined {
    const selectedFields = selectedFieldsForBlock(blockId, selectedOutputs)
    if (
      selectedFields.length !== 1 ||
      !declaresTopLevelStringField(responseFormat, selectedFields[0])
    ) {
      return undefined
    }

    const selectedField = selectedFields[0]
    return (sink) => {
      const projector = new IncrementalJsonStringFieldProjector(selectedField)
      return originalSubscribe({
        onEvent: async (event) => {
          if (event.type === 'text_delta') {
            const text = projector.push(event.text)
            if (text) await sink.onEvent({ ...event, text })
            return
          }

          await sink.onEvent(event)
          if (event.type === 'turn_end') projector.reset()
        },
      })
    }
  }

  private createProcessedStream(
    originalStream: ReadableStream,
    selectedFields: string[],
    blockId: string
  ): ReadableStream {
    let buffer = ''
    let hasProcessedComplete = false

    const self = this

    return new ReadableStream({
      async start(controller) {
        const reader = originalStream.getReader()
        const decoder = new TextDecoder()

        try {
          while (true) {
            const { done, value } = await reader.read()

            if (done) {
              buffer += decoder.decode()
              if (buffer.trim() && !hasProcessedComplete) {
                self.processCompleteJson(buffer, selectedFields, controller)
              }
              controller.close()
              break
            }

            const chunk = decoder.decode(value, { stream: true })
            buffer += chunk

            if (!hasProcessedComplete) {
              const processedChunk = self.processStreamingChunk(buffer, selectedFields)

              if (processedChunk) {
                controller.enqueue(new TextEncoder().encode(processedChunk))
                hasProcessedComplete = true
              }
            }
          }
        } catch (error) {
          logger.error('Error processing streaming response format:', { error, blockId })
          controller.error(error)
        } finally {
          reader.releaseLock()
        }
      },
    })
  }

  private processStreamingChunk(buffer: string, selectedFields: string[]): string | null {
    try {
      const parsed = JSON.parse(buffer.trim())
      if (typeof parsed === 'object' && parsed !== null) {
        const results: string[] = []
        for (const field of selectedFields) {
          if (field in parsed) {
            const value = parsed[field]
            const formattedValue = typeof value === 'string' ? value : JSON.stringify(value)
            results.push(formattedValue)
          }
        }

        if (results.length > 0) {
          const result = results.join('\n')
          return result
        }

        return null
      }
    } catch {}

    const openBraces = (buffer.match(/\{/g) || []).length
    const closeBraces = (buffer.match(/\}/g) || []).length

    if (openBraces > 0 && openBraces === closeBraces) {
      try {
        const parsed = JSON.parse(buffer.trim())
        if (typeof parsed === 'object' && parsed !== null) {
          const results: string[] = []
          for (const field of selectedFields) {
            if (field in parsed) {
              const value = parsed[field]
              const formattedValue = typeof value === 'string' ? value : JSON.stringify(value)
              results.push(formattedValue)
            }
          }

          if (results.length > 0) {
            const result = results.join('\n')
            return result
          }

          return null
        }
      } catch {}
    }

    return null
  }

  private processCompleteJson(
    buffer: string,
    selectedFields: string[],
    controller: ReadableStreamDefaultController
  ): void {
    try {
      const parsed = JSON.parse(buffer.trim())
      if (typeof parsed === 'object' && parsed !== null) {
        const results: string[] = []
        for (const field of selectedFields) {
          if (field in parsed) {
            const value = parsed[field]
            const formattedValue = typeof value === 'string' ? value : JSON.stringify(value)
            results.push(formattedValue)
          }
        }

        if (results.length > 0) {
          const result = results.join('\n')
          controller.enqueue(new TextEncoder().encode(result))
        }
      }
    } catch (error) {
      logger.warn('Failed to parse complete JSON in streaming processor:', { error })
    }
  }
}

export const streamingResponseFormatProcessor = new StreamingResponseFormatProcessor()
