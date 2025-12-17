import { createLogger } from '@/lib/logs/console/logger'
import { extractFunctionCall, extractTextContent } from '@/providers/google/utils'

const logger = createLogger('VertexUtils')

/**
 * Creates a ReadableStream from Vertex AI's Gemini stream response
 */
export function createReadableStreamFromVertexStream(
  response: Response,
  onComplete?: (
    content: string,
    usage?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
  ) => void
): ReadableStream<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Failed to get reader from response body')
  }

  return new ReadableStream({
    async start(controller) {
      try {
        let buffer = ''
        let fullContent = ''
        let usageData: {
          promptTokenCount?: number
          candidatesTokenCount?: number
          totalTokenCount?: number
        } | null = null

        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            if (buffer.trim()) {
              try {
                const data = JSON.parse(buffer.trim())
                if (data.usageMetadata) {
                  usageData = data.usageMetadata
                }
                const candidate = data.candidates?.[0]
                if (candidate?.content?.parts) {
                  const functionCall = extractFunctionCall(candidate)
                  if (functionCall) {
                    logger.debug(
                      'Function call detected in final buffer, ending stream to execute tool',
                      {
                        functionName: functionCall.name,
                      }
                    )
                    if (onComplete) onComplete(fullContent, usageData || undefined)
                    controller.close()
                    return
                  }
                  const content = extractTextContent(candidate)
                  if (content) {
                    fullContent += content
                    controller.enqueue(new TextEncoder().encode(content))
                  }
                }
              } catch (e) {
                if (buffer.trim().startsWith('[')) {
                  try {
                    const dataArray = JSON.parse(buffer.trim())
                    if (Array.isArray(dataArray)) {
                      for (const item of dataArray) {
                        if (item.usageMetadata) {
                          usageData = item.usageMetadata
                        }
                        const candidate = item.candidates?.[0]
                        if (candidate?.content?.parts) {
                          const functionCall = extractFunctionCall(candidate)
                          if (functionCall) {
                            logger.debug(
                              'Function call detected in array item, ending stream to execute tool',
                              {
                                functionName: functionCall.name,
                              }
                            )
                            if (onComplete) onComplete(fullContent, usageData || undefined)
                            controller.close()
                            return
                          }
                          const content = extractTextContent(candidate)
                          if (content) {
                            fullContent += content
                            controller.enqueue(new TextEncoder().encode(content))
                          }
                        }
                      }
                    }
                  } catch (arrayError) {
                    // Buffer is not valid JSON array
                  }
                }
              }
            }
            if (onComplete) onComplete(fullContent, usageData || undefined)
            controller.close()
            break
          }

          const text = new TextDecoder().decode(value)
          buffer += text

          let searchIndex = 0
          while (searchIndex < buffer.length) {
            const openBrace = buffer.indexOf('{', searchIndex)
            if (openBrace === -1) break

            let braceCount = 0
            let inString = false
            let escaped = false
            let closeBrace = -1

            for (let i = openBrace; i < buffer.length; i++) {
              const char = buffer[i]

              if (!inString) {
                if (char === '"' && !escaped) {
                  inString = true
                } else if (char === '{') {
                  braceCount++
                } else if (char === '}') {
                  braceCount--
                  if (braceCount === 0) {
                    closeBrace = i
                    break
                  }
                }
              } else {
                if (char === '"' && !escaped) {
                  inString = false
                }
              }

              escaped = char === '\\' && !escaped
            }

            if (closeBrace !== -1) {
              const jsonStr = buffer.substring(openBrace, closeBrace + 1)

              try {
                const data = JSON.parse(jsonStr)

                if (data.usageMetadata) {
                  usageData = data.usageMetadata
                }

                const candidate = data.candidates?.[0]

                if (candidate?.finishReason === 'UNEXPECTED_TOOL_CALL') {
                  logger.warn(
                    'Vertex AI returned UNEXPECTED_TOOL_CALL - model attempted to call a tool that was not provided',
                    {
                      finishReason: candidate.finishReason,
                      hasContent: !!candidate?.content,
                      hasParts: !!candidate?.content?.parts,
                    }
                  )
                  const textContent = extractTextContent(candidate)
                  if (textContent) {
                    fullContent += textContent
                    controller.enqueue(new TextEncoder().encode(textContent))
                  }
                  if (onComplete) onComplete(fullContent, usageData || undefined)
                  controller.close()
                  return
                }

                if (candidate?.content?.parts) {
                  const functionCall = extractFunctionCall(candidate)
                  if (functionCall) {
                    logger.debug(
                      'Function call detected in stream, ending stream to execute tool',
                      {
                        functionName: functionCall.name,
                      }
                    )
                    if (onComplete) onComplete(fullContent, usageData || undefined)
                    controller.close()
                    return
                  }
                  const content = extractTextContent(candidate)
                  if (content) {
                    fullContent += content
                    controller.enqueue(new TextEncoder().encode(content))
                  }
                }
              } catch (e) {
                logger.error('Error parsing JSON from stream', {
                  error: e instanceof Error ? e.message : String(e),
                  jsonPreview: jsonStr.substring(0, 200),
                })
              }

              buffer = buffer.substring(closeBrace + 1)
              searchIndex = 0
            } else {
              break
            }
          }
        }
      } catch (e) {
        logger.error('Error reading Vertex AI stream', {
          error: e instanceof Error ? e.message : String(e),
        })
        controller.error(e)
      }
    },
    async cancel() {
      await reader.cancel()
    },
  })
}

/**
 * Build Vertex AI endpoint URL
 */
export function buildVertexEndpoint(
  project: string,
  location: string,
  model: string,
  isStreaming: boolean
): string {
  const action = isStreaming ? 'streamGenerateContent' : 'generateContent'

  if (location === 'global') {
    return `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:${action}`
  }

  return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:${action}`
}
