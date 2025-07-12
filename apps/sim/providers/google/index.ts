import { createLogger } from '@/lib/logs/console-logger'
import type { StreamingExecution } from '@/executor/types'
import { executeTool } from '@/tools'
import { getProviderDefaultModel, getProviderModels } from '../models'
import type { ProviderConfig, ProviderRequest, ProviderResponse, TimeSegment } from '../types'
import { prepareToolExecution } from '../utils'

const logger = createLogger('GoogleProvider')

/**
 * Creates a ReadableStream from Google's Gemini stream response
 */
function createReadableStreamFromGeminiStream(response: Response): ReadableStream<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Failed to get reader from response body')
  }

  return new ReadableStream({
    async start(controller) {
      try {
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            // Try to parse any remaining buffer as complete JSON
            if (buffer.trim()) {
              logger.debug('Processing final buffer', {
                bufferLength: buffer.length,
                bufferPreview: buffer.substring(0, 200),
              })
              try {
                const data = JSON.parse(buffer.trim())
                const candidate = data.candidates?.[0]
                if (candidate?.content?.parts) {
                  // Check if this is a function call
                  const functionCall = extractFunctionCall(candidate)
                  if (functionCall) {
                    logger.debug('Function call detected in final buffer, should not be streamed', {
                      functionName: functionCall.name,
                    })
                  } else {
                    const content = extractTextContent(candidate)
                    if (content) {
                      logger.debug('Extracted content from final buffer', {
                        contentLength: content.length,
                      })
                      controller.enqueue(new TextEncoder().encode(content))
                    }
                  }
                }
              } catch (e) {
                logger.debug('Final buffer not valid JSON, checking if it contains JSON array', {
                  error: e instanceof Error ? e.message : String(e),
                })
                // Try parsing as JSON array if it starts with [
                if (buffer.trim().startsWith('[')) {
                  try {
                    const dataArray = JSON.parse(buffer.trim())
                    if (Array.isArray(dataArray)) {
                      for (const item of dataArray) {
                        const candidate = item.candidates?.[0]
                        if (candidate?.content?.parts) {
                          // Check if this is a function call
                          const functionCall = extractFunctionCall(candidate)
                          if (functionCall) {
                            logger.debug(
                              'Function call detected in array item, should not be streamed',
                              {
                                functionName: functionCall.name,
                              }
                            )
                          } else {
                            const content = extractTextContent(candidate)
                            if (content) {
                              logger.debug('Extracted content from array item', {
                                contentLength: content.length,
                              })
                              controller.enqueue(new TextEncoder().encode(content))
                            }
                          }
                        }
                      }
                    }
                  } catch (arrayError) {
                    logger.debug('Buffer also not valid JSON array', {
                      error: arrayError instanceof Error ? arrayError.message : String(arrayError),
                    })
                  }
                }
              }
            }
            controller.close()
            break
          }

          const text = new TextDecoder().decode(value)
          buffer += text

          logger.debug('Received chunk from Gemini stream', {
            chunkLength: text.length,
            bufferLength: buffer.length,
            chunkPreview: text.substring(0, 100),
          })

          // Try to find complete JSON objects in buffer
          // Look for patterns like: {...}\n{...} or just a single {...}
          let searchIndex = 0
          while (searchIndex < buffer.length) {
            const openBrace = buffer.indexOf('{', searchIndex)
            if (openBrace === -1) break

            // Try to find the matching closing brace
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
              // Found a complete JSON object
              const jsonStr = buffer.substring(openBrace, closeBrace + 1)

              try {
                const data = JSON.parse(jsonStr)
                logger.debug('Parsed complete JSON from stream', {
                  hasCandidate: !!data.candidates?.[0],
                  hasParts: !!data.candidates?.[0]?.content?.parts,
                  finishReason: data.candidates?.[0]?.finishReason,
                  jsonLength: jsonStr.length,
                })

                const candidate = data.candidates?.[0]

                // Handle specific finish reasons
                if (candidate?.finishReason === 'UNEXPECTED_TOOL_CALL') {
                  logger.warn('Gemini returned UNEXPECTED_TOOL_CALL in streaming mode', {
                    finishReason: candidate.finishReason,
                    hasContent: !!candidate?.content,
                    hasParts: !!candidate?.content?.parts,
                  })
                  // This indicates a configuration issue - tools might be improperly configured for streaming
                  continue
                }

                if (candidate?.content?.parts) {
                  // Check if this is a function call
                  const functionCall = extractFunctionCall(candidate)
                  if (functionCall) {
                    logger.debug('Function call detected in stream, should not be streamed', {
                      functionName: functionCall.name,
                    })
                    // Function calls should not be streamed, they should be handled by tool execution flow
                    // This indicates a configuration issue - streaming shouldn't happen for function calls
                  } else {
                    const content = extractTextContent(candidate)
                    if (content) {
                      logger.debug('Extracted content from stream', {
                        contentLength: content.length,
                      })
                      controller.enqueue(new TextEncoder().encode(content))
                    }
                  }
                }
              } catch (e) {
                logger.error('Error parsing JSON from stream', {
                  error: e instanceof Error ? e.message : String(e),
                  jsonPreview: jsonStr.substring(0, 200),
                })
              }

              // Remove processed JSON from buffer and continue searching
              buffer = buffer.substring(closeBrace + 1)
              searchIndex = 0
            } else {
              // No complete JSON object found, wait for more data
              break
            }
          }
        }
      } catch (e) {
        logger.error('Error reading Google Gemini stream', {
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

export const googleProvider: ProviderConfig = {
  id: 'google',
  name: 'Google',
  description: "Google's Gemini models",
  version: '1.0.0',
  models: getProviderModels('google'),
  defaultModel: getProviderDefaultModel('google'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Google Gemini')
    }

    logger.info('Preparing Google Gemini request', {
      model: request.model || 'gemini-2.5-pro',
      hasSystemPrompt: !!request.systemPrompt,
      hasMessages: !!request.messages?.length,
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      streaming: !!request.stream,
    })

    // Start execution timer for the entire provider execution
    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      // Convert messages to Gemini format
      const { contents, tools, systemInstruction } = convertToGeminiFormat(request)

      const requestedModel = request.model || 'gemini-2.5-pro'

      // Build request payload
      const payload: any = {
        contents,
        generationConfig: {},
      }

      // Add temperature if specified
      if (request.temperature !== undefined && request.temperature !== null) {
        payload.generationConfig.temperature = request.temperature
      }

      // Add max tokens if specified
      if (request.maxTokens !== undefined) {
        payload.generationConfig.maxOutputTokens = request.maxTokens
      }

      // Add system instruction if provided
      if (systemInstruction) {
        payload.systemInstruction = systemInstruction
      }

      // Add structured output format if requested
      if (request.responseFormat) {
        const responseFormatSchema = request.responseFormat.schema || request.responseFormat

        // Clean the schema using our helper function
        const cleanSchema = cleanSchemaForGemini(responseFormatSchema)

        // Use Gemini's native structured output approach
        payload.generationConfig.responseMimeType = 'application/json'
        payload.generationConfig.responseSchema = cleanSchema

        logger.info('Using Gemini native structured output format', {
          hasSchema: !!cleanSchema,
          mimeType: 'application/json',
        })
      }

      // Add tools if provided
      if (tools?.length) {
        payload.tools = [
          {
            functionDeclarations: tools,
          },
        ]

        logger.info('Google Gemini request with tools:', {
          toolCount: tools.length,
          model: requestedModel,
          tools: tools.map((t) => t.name),
        })
      }

      // Make the API request
      const initialCallTime = Date.now()

      // Disable streaming for initial requests when tools are present to avoid function calls in streams
      // Only enable streaming for the final response after tool execution
      const shouldStream = request.stream && !tools?.length

      // Use streamGenerateContent for streaming requests
      const endpoint = shouldStream
        ? `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:streamGenerateContent?key=${request.apiKey}`
        : `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent?key=${request.apiKey}`

      if (request.stream && tools?.length) {
        logger.info('Streaming disabled for initial request due to tools presence', {
          toolCount: tools.length,
          willStreamAfterTools: true,
        })
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const responseText = await response.text()
        logger.error('Gemini API error details:', {
          status: response.status,
          statusText: response.statusText,
          responseBody: responseText,
        })
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`)
      }

      const firstResponseTime = Date.now() - initialCallTime

      // Handle streaming response
      if (shouldStream) {
        logger.info('Handling Google Gemini streaming response')

        // Create a ReadableStream from the Google Gemini stream
        const stream = createReadableStreamFromGeminiStream(response)

        // Create an object that combines the stream with execution metadata
        const streamingExecution: StreamingExecution = {
          stream,
          execution: {
            success: true,
            output: {
              content: '',
              model: request.model,
              tokens: {
                prompt: 0,
                completion: 0,
                total: 0,
              },
              providerTiming: {
                startTime: providerStartTimeISO,
                endTime: new Date().toISOString(),
                duration: firstResponseTime,
                modelTime: firstResponseTime,
                toolsTime: 0,
                firstResponseTime,
                iterations: 1,
                timeSegments: [
                  {
                    type: 'model',
                    name: 'Initial streaming response',
                    startTime: initialCallTime,
                    endTime: initialCallTime + firstResponseTime,
                    duration: firstResponseTime,
                  },
                ],
                cost: {
                  total: 0.0, // Initial estimate, updated as tokens are processed
                  input: 0.0,
                  output: 0.0,
                },
              },
            },
            logs: [],
            metadata: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: firstResponseTime,
            },
            isStreaming: true,
          },
        }

        return streamingExecution
      }

      let geminiResponse = await response.json()

      // Check structured output format
      if (payload.generationConfig?.responseSchema) {
        const candidate = geminiResponse.candidates?.[0]
        if (candidate?.content?.parts?.[0]?.text) {
          const text = candidate.content.parts[0].text
          try {
            // Validate JSON structure
            JSON.parse(text)
            logger.info('Successfully received structured JSON output')
          } catch (_e) {
            logger.warn('Failed to parse structured output as JSON')
          }
        }
      }

      // Initialize response tracking variables
      let content = ''
      let tokens = {
        prompt: 0,
        completion: 0,
        total: 0,
      }
      const toolCalls = []
      const toolResults = []
      let iterationCount = 0
      const MAX_ITERATIONS = 10 // Prevent infinite loops

      // Track time spent in model vs tools
      let modelTime = firstResponseTime
      let toolsTime = 0

      // Track each model and tool call segment with timestamps
      const timeSegments: TimeSegment[] = [
        {
          type: 'model',
          name: 'Initial response',
          startTime: initialCallTime,
          endTime: initialCallTime + firstResponseTime,
          duration: firstResponseTime,
        },
      ]

      try {
        // Extract content or function calls from initial response
        const candidate = geminiResponse.candidates?.[0]

        // Check if response contains function calls
        const functionCall = extractFunctionCall(candidate)

        if (functionCall) {
          logger.info(`Received function call from Gemini: ${functionCall.name}`)

          // Process function calls in a loop
          while (iterationCount < MAX_ITERATIONS) {
            // Get the latest function calls
            const latestResponse = geminiResponse.candidates?.[0]
            const latestFunctionCall = extractFunctionCall(latestResponse)

            if (!latestFunctionCall) {
              // No more function calls - extract final text content
              content = extractTextContent(latestResponse)
              break
            }

            logger.info(
              `Processing function call: ${latestFunctionCall.name} (iteration ${iterationCount + 1}/${MAX_ITERATIONS})`
            )

            // Track time for tool calls
            const toolsStartTime = Date.now()

            try {
              const toolName = latestFunctionCall.name
              const toolArgs = latestFunctionCall.args || {}

              // Get the tool from the tools registry
              const tool = request.tools?.find((t) => t.id === toolName)
              if (!tool) {
                logger.warn(`Tool ${toolName} not found in registry, skipping`)
                break
              }

              // Execute the tool
              const toolCallStartTime = Date.now()

              const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)
              const result = await executeTool(toolName, executionParams, true)
              const toolCallEndTime = Date.now()
              const toolCallDuration = toolCallEndTime - toolCallStartTime

              // Add to time segments for both success and failure
              timeSegments.push({
                type: 'tool',
                name: toolName,
                startTime: toolCallStartTime,
                endTime: toolCallEndTime,
                duration: toolCallDuration,
              })

              // Prepare result content for the LLM
              let resultContent: any
              if (result.success) {
                toolResults.push(result.output)
                resultContent = result.output
              } else {
                // Include error information so LLM can respond appropriately
                resultContent = {
                  error: true,
                  message: result.error || 'Tool execution failed',
                  tool: toolName,
                }
              }

              toolCalls.push({
                name: toolName,
                arguments: toolParams,
                startTime: new Date(toolCallStartTime).toISOString(),
                endTime: new Date(toolCallEndTime).toISOString(),
                duration: toolCallDuration,
                result: resultContent,
                success: result.success,
              })

              // Prepare for next request with simplified messages
              // Use simple format: original query + most recent function call + result
              const simplifiedMessages = [
                // Original user request - find the first user request
                ...(contents.filter((m) => m.role === 'user').length > 0
                  ? [contents.filter((m) => m.role === 'user')[0]]
                  : [contents[0]]),
                // Function call from model
                {
                  role: 'model',
                  parts: [
                    {
                      functionCall: {
                        name: latestFunctionCall.name,
                        args: latestFunctionCall.args,
                      },
                    },
                  ],
                },
                // Function response - but use USER role since Gemini only accepts user or model
                {
                  role: 'user',
                  parts: [
                    {
                      text: `Function ${latestFunctionCall.name} result: ${JSON.stringify(resultContent)}`,
                    },
                  ],
                },
              ]

              // Calculate tool call time
              const thisToolsTime = Date.now() - toolsStartTime
              toolsTime += thisToolsTime

              // Make the next request with updated messages
              const nextModelStartTime = Date.now()

              try {
                // Check if we should stream the final response after tool calls
                if (request.stream) {
                  // Create a payload for the streaming response after tool calls
                  const streamingPayload = {
                    ...payload,
                    contents: simplifiedMessages,
                    toolConfig: { functionCallingConfig: { mode: 'AUTO' } }, // Always use AUTO mode for streaming after tools
                  }

                  logger.info('Streaming payload for tool call follow-up', {
                    contents: simplifiedMessages,
                    toolConfig: streamingPayload.toolConfig,
                    hasTools: !!streamingPayload.tools,
                  })

                  // Remove any forced tool configuration to prevent issues with streaming
                  if ('toolConfig' in streamingPayload) {
                    streamingPayload.toolConfig = { functionCallingConfig: { mode: 'AUTO' } }
                  }

                  // Make the streaming request with streamGenerateContent endpoint
                  const streamingResponse = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:streamGenerateContent?key=${request.apiKey}`,
                    {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify(streamingPayload),
                    }
                  )

                  if (!streamingResponse.ok) {
                    const errorBody = await streamingResponse.text()
                    logger.error('Error in Gemini streaming follow-up request:', {
                      status: streamingResponse.status,
                      statusText: streamingResponse.statusText,
                      responseBody: errorBody,
                    })
                    throw new Error(
                      `Gemini API streaming error: ${streamingResponse.status} ${streamingResponse.statusText}`
                    )
                  }

                  // Create a stream from the response
                  const stream = createReadableStreamFromGeminiStream(streamingResponse)

                  // Calculate timing information
                  const nextModelEndTime = Date.now()
                  const thisModelTime = nextModelEndTime - nextModelStartTime
                  modelTime += thisModelTime

                  // Add to time segments
                  timeSegments.push({
                    type: 'model',
                    name: 'Final streaming response after tool calls',
                    startTime: nextModelStartTime,
                    endTime: nextModelEndTime,
                    duration: thisModelTime,
                  })

                  // Return a streaming execution with tool call information
                  const streamingExecution: StreamingExecution = {
                    stream,
                    execution: {
                      success: true,
                      output: {
                        content: '',
                        model: request.model,
                        tokens,
                        toolCalls:
                          toolCalls.length > 0
                            ? {
                                list: toolCalls,
                                count: toolCalls.length,
                              }
                            : undefined,
                        toolResults,
                        providerTiming: {
                          startTime: providerStartTimeISO,
                          endTime: new Date().toISOString(),
                          duration: Date.now() - providerStartTime,
                          modelTime,
                          toolsTime,
                          firstResponseTime,
                          iterations: iterationCount + 1,
                          timeSegments,
                        },
                        cost: {
                          total: (tokens.total || 0) * 0.0001, // Estimate cost based on tokens
                          input: (tokens.prompt || 0) * 0.0001,
                          output: (tokens.completion || 0) * 0.0001,
                        },
                      },
                      logs: [],
                      metadata: {
                        startTime: providerStartTimeISO,
                        endTime: new Date().toISOString(),
                        duration: Date.now() - providerStartTime,
                      },
                      isStreaming: true,
                    },
                  }

                  return streamingExecution
                }

                // Make the next request for non-streaming response
                const nextResponse = await fetch(
                  `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent?key=${request.apiKey}`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      ...payload,
                      contents: simplifiedMessages,
                    }),
                  }
                )

                if (!nextResponse.ok) {
                  const errorBody = await nextResponse.text()
                  logger.error('Error in Gemini follow-up request:', {
                    status: nextResponse.status,
                    statusText: nextResponse.statusText,
                    responseBody: errorBody,
                    iterationCount,
                  })
                  break
                }

                geminiResponse = await nextResponse.json()

                const nextModelEndTime = Date.now()
                const thisModelTime = nextModelEndTime - nextModelStartTime

                // Add to time segments
                timeSegments.push({
                  type: 'model',
                  name: `Model response (iteration ${iterationCount + 1})`,
                  startTime: nextModelStartTime,
                  endTime: nextModelEndTime,
                  duration: thisModelTime,
                })

                // Add to model time
                modelTime += thisModelTime

                // Check if we need to continue or break
                const nextCandidate = geminiResponse.candidates?.[0]
                const nextFunctionCall = extractFunctionCall(nextCandidate)

                if (!nextFunctionCall) {
                  content = extractTextContent(nextCandidate)
                  break
                }

                iterationCount++
              } catch (error) {
                logger.error('Error in Gemini follow-up request:', {
                  error: error instanceof Error ? error.message : String(error),
                  iterationCount,
                })
                break
              }
            } catch (error) {
              logger.error('Error processing function call:', {
                error: error instanceof Error ? error.message : String(error),
                functionName: latestFunctionCall?.name || 'unknown',
              })
              break
            }
          }
        } else {
          // Regular text response
          content = extractTextContent(candidate)
        }
      } catch (error) {
        logger.error('Error processing Gemini response:', {
          error: error instanceof Error ? error.message : String(error),
          iterationCount,
        })

        // Don't rethrow, so we can still return partial results
        if (!content && toolCalls.length > 0) {
          content = `Tool call(s) executed: ${toolCalls.map((t) => t.name).join(', ')}. Results are available in the tool results.`
        }
      }

      // Calculate overall timing
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      // Extract token usage if available
      if (geminiResponse.usageMetadata) {
        tokens = {
          prompt: geminiResponse.usageMetadata.promptTokenCount || 0,
          completion: geminiResponse.usageMetadata.candidatesTokenCount || 0,
          total:
            (geminiResponse.usageMetadata.promptTokenCount || 0) +
            (geminiResponse.usageMetadata.candidatesTokenCount || 0),
        }
      }

      return {
        content,
        model: request.model,
        tokens,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
        timing: {
          startTime: providerStartTimeISO,
          endTime: providerEndTimeISO,
          duration: totalDuration,
          modelTime: modelTime,
          toolsTime: toolsTime,
          firstResponseTime: firstResponseTime,
          iterations: iterationCount + 1,
          timeSegments: timeSegments,
        },
      }
    } catch (error) {
      // Include timing information even for errors
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      logger.error('Error in Google Gemini request:', {
        error: error instanceof Error ? error.message : String(error),
        duration: totalDuration,
      })

      // Create a new error with timing information
      const enhancedError = new Error(error instanceof Error ? error.message : String(error))
      // @ts-ignore - Adding timing property to the error
      enhancedError.timing = {
        startTime: providerStartTimeISO,
        endTime: providerEndTimeISO,
        duration: totalDuration,
      }

      throw enhancedError
    }
  },
}

/**
 * Helper function to remove additionalProperties from a schema object
 * and perform a deep copy of the schema to avoid modifying the original
 */
function cleanSchemaForGemini(schema: any): any {
  // Handle base cases
  if (schema === null || schema === undefined) return schema
  if (typeof schema !== 'object') return schema
  if (Array.isArray(schema)) {
    return schema.map((item) => cleanSchemaForGemini(item))
  }

  // Create a new object for the deep copy
  const cleanedSchema: any = {}

  // Process each property in the schema
  for (const key in schema) {
    // Skip additionalProperties
    if (key === 'additionalProperties') continue

    // Deep copy nested objects
    cleanedSchema[key] = cleanSchemaForGemini(schema[key])
  }

  return cleanedSchema
}

/**
 * Helper function to extract content from a Gemini response, handling structured output
 */
function extractTextContent(candidate: any): string {
  if (!candidate?.content?.parts) return ''

  // Check for JSON response (typically from structured output)
  if (candidate.content.parts?.length === 1 && candidate.content.parts[0].text) {
    const text = candidate.content.parts[0].text
    if (text && (text.trim().startsWith('{') || text.trim().startsWith('['))) {
      try {
        JSON.parse(text) // Validate JSON
        return text // Return valid JSON as-is
      } catch (_e) {
        /* Not valid JSON, continue with normal extraction */
      }
    }
  }

  // Standard text extraction
  return candidate.content.parts
    .filter((part: any) => part.text)
    .map((part: any) => part.text)
    .join('\n')
}

/**
 * Helper function to extract a function call from a Gemini response
 */
function extractFunctionCall(candidate: any): { name: string; args: any } | null {
  if (!candidate?.content?.parts) return null

  // Check for functionCall in parts
  for (const part of candidate.content.parts) {
    if (part.functionCall) {
      const args = part.functionCall.args || {}
      // Parse string args if they look like JSON
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

  // Check for alternative function_call format
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
 * Convert OpenAI-style request format to Gemini format
 */
function convertToGeminiFormat(request: ProviderRequest): {
  contents: any[]
  tools: any[] | undefined
  systemInstruction: any | undefined
} {
  const contents = []
  let systemInstruction

  // Handle system prompt
  if (request.systemPrompt) {
    systemInstruction = { parts: [{ text: request.systemPrompt }] }
  }

  // Add context as user message if present
  if (request.context) {
    contents.push({ role: 'user', parts: [{ text: request.context }] })
  }

  // Process messages
  if (request.messages && request.messages.length > 0) {
    for (const message of request.messages) {
      if (message.role === 'system') {
        // Add to system instruction
        if (!systemInstruction) {
          systemInstruction = { parts: [{ text: message.content }] }
        } else {
          // Append to existing system instruction
          systemInstruction.parts[0].text = `${systemInstruction.parts[0].text || ''}\n${message.content}`
        }
      } else if (message.role === 'user' || message.role === 'assistant') {
        // Convert to Gemini role format
        const geminiRole = message.role === 'user' ? 'user' : 'model'

        // Add text content
        if (message.content) {
          contents.push({ role: geminiRole, parts: [{ text: message.content }] })
        }

        // Handle tool calls
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
        // Convert tool response (Gemini only accepts user/model roles)
        contents.push({
          role: 'user',
          parts: [{ text: `Function result: ${message.content}` }],
        })
      }
    }
  }

  // Convert tools to Gemini function declarations
  const tools = request.tools?.map((tool) => {
    const toolParameters = { ...(tool.parameters || {}) }

    // Process schema properties
    if (toolParameters.properties) {
      const properties = { ...toolParameters.properties }
      const required = toolParameters.required ? [...toolParameters.required] : []

      // Remove defaults and optional parameters
      for (const key in properties) {
        const prop = properties[key] as any

        if (prop.default !== undefined) {
          const { default: _, ...cleanProp } = prop
          properties[key] = cleanProp
        }
      }

      // Build Gemini-compatible parameters schema
      const parameters = {
        type: toolParameters.type || 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
      }

      // Clean schema for Gemini
      return {
        name: tool.id,
        description: tool.description || `Execute the ${tool.id} function`,
        parameters: cleanSchemaForGemini(parameters),
      }
    }

    // Simple schema case
    return {
      name: tool.id,
      description: tool.description || `Execute the ${tool.id} function`,
      parameters: cleanSchemaForGemini(toolParameters),
    }
  })

  return { contents, tools, systemInstruction }
}
