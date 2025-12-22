import { createLogger } from '@/lib/logs/console/logger'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import {
  cleanSchemaForGemini,
  convertToGeminiFormat,
  extractFunctionCall,
  extractTextContent,
} from '@/providers/google/utils'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import type {
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/types'
import {
  calculateCost,
  prepareToolExecution,
  prepareToolsWithUsageControl,
  trackForcedToolUsage,
} from '@/providers/utils'
import { executeTool } from '@/tools'

const logger = createLogger('GoogleProvider')

interface GeminiStreamUsage {
  promptTokenCount: number
  candidatesTokenCount: number
  totalTokenCount: number
}

function createReadableStreamFromGeminiStream(
  response: Response,
  onComplete?: (content: string, usage: GeminiStreamUsage) => void
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
        let promptTokenCount = 0
        let candidatesTokenCount = 0
        let totalTokenCount = 0

        const updateUsage = (metadata: any) => {
          if (metadata) {
            promptTokenCount = metadata.promptTokenCount ?? promptTokenCount
            candidatesTokenCount = metadata.candidatesTokenCount ?? candidatesTokenCount
            totalTokenCount = metadata.totalTokenCount ?? totalTokenCount
          }
        }

        const buildUsage = (): GeminiStreamUsage => ({
          promptTokenCount,
          candidatesTokenCount,
          totalTokenCount,
        })

        const complete = () => {
          if (onComplete) {
            if (promptTokenCount === 0 && candidatesTokenCount === 0) {
              logger.warn('Gemini stream completed without usage metadata')
            }
            onComplete(fullContent, buildUsage())
          }
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            if (buffer.trim()) {
              try {
                const data = JSON.parse(buffer.trim())
                updateUsage(data.usageMetadata)
                const candidate = data.candidates?.[0]
                if (candidate?.content?.parts) {
                  const functionCall = extractFunctionCall(candidate)
                  if (functionCall) {
                    logger.debug('Function call detected in final buffer', {
                      functionName: functionCall.name,
                    })
                    complete()
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
                        updateUsage(item.usageMetadata)
                        const candidate = item.candidates?.[0]
                        if (candidate?.content?.parts) {
                          const functionCall = extractFunctionCall(candidate)
                          if (functionCall) {
                            logger.debug('Function call detected in array item', {
                              functionName: functionCall.name,
                            })
                            complete()
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
                  } catch (_) {}
                }
              }
            }
            complete()
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
                updateUsage(data.usageMetadata)
                const candidate = data.candidates?.[0]

                if (candidate?.finishReason === 'UNEXPECTED_TOOL_CALL') {
                  logger.warn('Gemini returned UNEXPECTED_TOOL_CALL in streaming mode')
                  const textContent = extractTextContent(candidate)
                  if (textContent) {
                    fullContent += textContent
                    controller.enqueue(new TextEncoder().encode(textContent))
                  }
                  complete()
                  controller.close()
                  return
                }

                if (candidate?.content?.parts) {
                  const functionCall = extractFunctionCall(candidate)
                  if (functionCall) {
                    logger.debug('Function call detected in stream', {
                      functionName: functionCall.name,
                    })
                    complete()
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

    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      const { contents, tools, systemInstruction } = convertToGeminiFormat(request)

      const requestedModel = request.model || 'gemini-2.5-pro'

      const payload: any = {
        contents,
        generationConfig: {},
      }

      if (request.temperature !== undefined && request.temperature !== null) {
        payload.generationConfig.temperature = request.temperature
      }

      if (request.maxTokens !== undefined) {
        payload.generationConfig.maxOutputTokens = request.maxTokens
      }

      if (systemInstruction) {
        payload.systemInstruction = systemInstruction
      }

      if (request.responseFormat && !tools?.length) {
        const responseFormatSchema = request.responseFormat.schema || request.responseFormat

        const cleanSchema = cleanSchemaForGemini(responseFormatSchema)

        payload.generationConfig.responseMimeType = 'application/json'
        payload.generationConfig.responseSchema = cleanSchema

        logger.info('Using Gemini native structured output format', {
          hasSchema: !!cleanSchema,
          mimeType: 'application/json',
        })
      } else if (request.responseFormat && tools?.length) {
        logger.warn(
          'Gemini does not support structured output (responseFormat) with function calling (tools). Structured output will be ignored.'
        )
      }

      let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null

      if (tools?.length) {
        preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'google')
        const { tools: filteredTools, toolConfig } = preparedTools

        if (filteredTools?.length) {
          payload.tools = [
            {
              functionDeclarations: filteredTools,
            },
          ]

          if (toolConfig) {
            payload.toolConfig = toolConfig
          }

          logger.info('Google Gemini request with tools:', {
            toolCount: filteredTools.length,
            model: requestedModel,
            tools: filteredTools.map((t) => t.name),
            hasToolConfig: !!toolConfig,
            toolConfig: toolConfig,
          })
        }
      }

      const initialCallTime = Date.now()

      const shouldStream = request.stream && !tools?.length

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

      if (shouldStream) {
        logger.info('Handling Google Gemini streaming response')

        const streamingResult: StreamingExecution = {
          stream: null as any,
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
              },
              cost: { input: 0, output: 0, total: 0 },
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

        streamingResult.stream = createReadableStreamFromGeminiStream(
          response,
          (content, usage) => {
            streamingResult.execution.output.content = content
            streamingResult.execution.output.tokens = {
              prompt: usage.promptTokenCount,
              completion: usage.candidatesTokenCount,
              total: usage.totalTokenCount || usage.promptTokenCount + usage.candidatesTokenCount,
            }

            const costResult = calculateCost(
              request.model,
              usage.promptTokenCount,
              usage.candidatesTokenCount
            )
            streamingResult.execution.output.cost = {
              input: costResult.input,
              output: costResult.output,
              total: costResult.total,
            }

            const streamEndTime = Date.now()
            const streamEndTimeISO = new Date(streamEndTime).toISOString()

            if (streamingResult.execution.output.providerTiming) {
              streamingResult.execution.output.providerTiming.endTime = streamEndTimeISO
              streamingResult.execution.output.providerTiming.duration =
                streamEndTime - providerStartTime

              if (streamingResult.execution.output.providerTiming.timeSegments?.[0]) {
                streamingResult.execution.output.providerTiming.timeSegments[0].endTime =
                  streamEndTime
                streamingResult.execution.output.providerTiming.timeSegments[0].duration =
                  streamEndTime - providerStartTime
              }
            }
          }
        )

        return streamingResult
      }

      let geminiResponse = await response.json()

      if (payload.generationConfig?.responseSchema) {
        const candidate = geminiResponse.candidates?.[0]
        if (candidate?.content?.parts?.[0]?.text) {
          const text = candidate.content.parts[0].text
          try {
            JSON.parse(text)
            logger.info('Successfully received structured JSON output')
          } catch (_e) {
            logger.warn('Failed to parse structured output as JSON')
          }
        }
      }

      let content = ''
      let tokens = {
        prompt: 0,
        completion: 0,
        total: 0,
      }
      const cost = {
        input: 0,
        output: 0,
        total: 0,
      }
      const toolCalls = []
      const toolResults = []
      let iterationCount = 0

      const originalToolConfig = preparedTools?.toolConfig
      const forcedTools = preparedTools?.forcedTools || []
      let usedForcedTools: string[] = []
      let hasUsedForcedTool = false
      let currentToolConfig = originalToolConfig

      const checkForForcedToolUsage = (functionCall: { name: string; args: any }) => {
        if (currentToolConfig && forcedTools.length > 0) {
          const toolCallsForTracking = [{ name: functionCall.name, arguments: functionCall.args }]
          const result = trackForcedToolUsage(
            toolCallsForTracking,
            currentToolConfig,
            logger,
            'google',
            forcedTools,
            usedForcedTools
          )
          hasUsedForcedTool = result.hasUsedForcedTool
          usedForcedTools = result.usedForcedTools

          if (result.nextToolConfig) {
            currentToolConfig = result.nextToolConfig
            logger.info('Updated tool config for next iteration', {
              hasNextToolConfig: !!currentToolConfig,
              usedForcedTools: usedForcedTools,
            })
          }
        }
      }

      let modelTime = firstResponseTime
      let toolsTime = 0

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
        const candidate = geminiResponse.candidates?.[0]

        if (candidate?.finishReason === 'UNEXPECTED_TOOL_CALL') {
          logger.warn(
            'Gemini returned UNEXPECTED_TOOL_CALL - model attempted to call a tool that was not provided',
            {
              finishReason: candidate.finishReason,
              hasContent: !!candidate?.content,
              hasParts: !!candidate?.content?.parts,
            }
          )
          content = extractTextContent(candidate)
        }

        const functionCall = extractFunctionCall(candidate)

        if (functionCall) {
          logger.info(`Received function call from Gemini: ${functionCall.name}`)

          while (iterationCount < MAX_TOOL_ITERATIONS) {
            const latestResponse = geminiResponse.candidates?.[0]
            const latestFunctionCall = extractFunctionCall(latestResponse)

            if (!latestFunctionCall) {
              content = extractTextContent(latestResponse)
              break
            }

            logger.info(
              `Processing function call: ${latestFunctionCall.name} (iteration ${iterationCount + 1}/${MAX_TOOL_ITERATIONS})`
            )

            const toolsStartTime = Date.now()

            try {
              const toolName = latestFunctionCall.name
              const toolArgs = latestFunctionCall.args || {}

              const tool = request.tools?.find((t) => t.id === toolName)
              if (!tool) {
                logger.warn(`Tool ${toolName} not found in registry, skipping`)
                break
              }

              const toolCallStartTime = Date.now()

              const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)
              const result = await executeTool(toolName, executionParams, true)
              const toolCallEndTime = Date.now()
              const toolCallDuration = toolCallEndTime - toolCallStartTime

              timeSegments.push({
                type: 'tool',
                name: toolName,
                startTime: toolCallStartTime,
                endTime: toolCallEndTime,
                duration: toolCallDuration,
              })

              let resultContent: any
              if (result.success) {
                toolResults.push(result.output)
                resultContent = result.output
              } else {
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

              const simplifiedMessages = [
                ...(contents.filter((m) => m.role === 'user').length > 0
                  ? [contents.filter((m) => m.role === 'user')[0]]
                  : [contents[0]]),
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
                {
                  role: 'user',
                  parts: [
                    {
                      text: `Function ${latestFunctionCall.name} result: ${JSON.stringify(resultContent)}`,
                    },
                  ],
                },
              ]

              const thisToolsTime = Date.now() - toolsStartTime
              toolsTime += thisToolsTime

              checkForForcedToolUsage(latestFunctionCall)

              const nextModelStartTime = Date.now()

              try {
                if (request.stream) {
                  const streamingPayload = {
                    ...payload,
                    contents: simplifiedMessages,
                  }

                  const allForcedToolsUsed =
                    forcedTools.length > 0 && usedForcedTools.length === forcedTools.length

                  if (allForcedToolsUsed && request.responseFormat) {
                    streamingPayload.tools = undefined
                    streamingPayload.toolConfig = undefined

                    const responseFormatSchema =
                      request.responseFormat.schema || request.responseFormat
                    const cleanSchema = cleanSchemaForGemini(responseFormatSchema)

                    if (!streamingPayload.generationConfig) {
                      streamingPayload.generationConfig = {}
                    }
                    streamingPayload.generationConfig.responseMimeType = 'application/json'
                    streamingPayload.generationConfig.responseSchema = cleanSchema

                    logger.info('Using structured output for final response after tool execution')
                  } else {
                    if (currentToolConfig) {
                      streamingPayload.toolConfig = currentToolConfig
                    } else {
                      streamingPayload.toolConfig = { functionCallingConfig: { mode: 'AUTO' } }
                    }
                  }

                  const checkPayload = {
                    ...streamingPayload,
                  }
                  checkPayload.stream = undefined

                  const checkResponse = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent?key=${request.apiKey}`,
                    {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify(checkPayload),
                    }
                  )

                  if (!checkResponse.ok) {
                    const errorBody = await checkResponse.text()
                    logger.error('Error in Gemini check request:', {
                      status: checkResponse.status,
                      statusText: checkResponse.statusText,
                      responseBody: errorBody,
                    })
                    throw new Error(
                      `Gemini API check error: ${checkResponse.status} ${checkResponse.statusText}`
                    )
                  }

                  const checkResult = await checkResponse.json()
                  const checkCandidate = checkResult.candidates?.[0]
                  const checkFunctionCall = extractFunctionCall(checkCandidate)

                  if (checkFunctionCall) {
                    logger.info(
                      'Function call detected in follow-up, handling in non-streaming mode',
                      {
                        functionName: checkFunctionCall.name,
                      }
                    )

                    geminiResponse = checkResult

                    if (checkResult.usageMetadata) {
                      tokens.prompt += checkResult.usageMetadata.promptTokenCount || 0
                      tokens.completion += checkResult.usageMetadata.candidatesTokenCount || 0
                      tokens.total +=
                        (checkResult.usageMetadata.promptTokenCount || 0) +
                        (checkResult.usageMetadata.candidatesTokenCount || 0)

                      const iterationCost = calculateCost(
                        request.model,
                        checkResult.usageMetadata.promptTokenCount || 0,
                        checkResult.usageMetadata.candidatesTokenCount || 0
                      )
                      cost.input += iterationCost.input
                      cost.output += iterationCost.output
                      cost.total += iterationCost.total
                    }

                    const nextModelEndTime = Date.now()
                    const thisModelTime = nextModelEndTime - nextModelStartTime
                    modelTime += thisModelTime

                    timeSegments.push({
                      type: 'model',
                      name: `Model response (iteration ${iterationCount + 1})`,
                      startTime: nextModelStartTime,
                      endTime: nextModelEndTime,
                      duration: thisModelTime,
                    })

                    iterationCount++
                    continue
                  }
                  logger.info('No function call detected, proceeding with streaming response')

                  // Apply structured output for the final response if responseFormat is specified
                  // This works regardless of whether tools were forced or auto
                  if (request.responseFormat) {
                    streamingPayload.tools = undefined
                    streamingPayload.toolConfig = undefined

                    const responseFormatSchema =
                      request.responseFormat.schema || request.responseFormat
                    const cleanSchema = cleanSchemaForGemini(responseFormatSchema)

                    if (!streamingPayload.generationConfig) {
                      streamingPayload.generationConfig = {}
                    }
                    streamingPayload.generationConfig.responseMimeType = 'application/json'
                    streamingPayload.generationConfig.responseSchema = cleanSchema

                    logger.info(
                      'Using structured output for final streaming response after tool execution'
                    )
                  }

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

                  const nextModelEndTime = Date.now()
                  const thisModelTime = nextModelEndTime - nextModelStartTime
                  modelTime += thisModelTime

                  timeSegments.push({
                    type: 'model',
                    name: 'Final streaming response after tool calls',
                    startTime: nextModelStartTime,
                    endTime: nextModelEndTime,
                    duration: thisModelTime,
                  })

                  const streamingExecution: StreamingExecution = {
                    stream: null as any,
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
                        cost,
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

                  streamingExecution.stream = createReadableStreamFromGeminiStream(
                    streamingResponse,
                    (content, usage) => {
                      streamingExecution.execution.output.content = content

                      const existingTokens = streamingExecution.execution.output.tokens
                      streamingExecution.execution.output.tokens = {
                        prompt: (existingTokens?.prompt ?? 0) + usage.promptTokenCount,
                        completion: (existingTokens?.completion ?? 0) + usage.candidatesTokenCount,
                        total:
                          (existingTokens?.total ?? 0) +
                          (usage.totalTokenCount ||
                            usage.promptTokenCount + usage.candidatesTokenCount),
                      }

                      const streamCost = calculateCost(
                        request.model,
                        usage.promptTokenCount,
                        usage.candidatesTokenCount
                      )
                      const existingCost = streamingExecution.execution.output.cost as any
                      streamingExecution.execution.output.cost = {
                        input: (existingCost?.input ?? 0) + streamCost.input,
                        output: (existingCost?.output ?? 0) + streamCost.output,
                        total: (existingCost?.total ?? 0) + streamCost.total,
                      }

                      const streamEndTime = Date.now()
                      const streamEndTimeISO = new Date(streamEndTime).toISOString()

                      if (streamingExecution.execution.output.providerTiming) {
                        streamingExecution.execution.output.providerTiming.endTime =
                          streamEndTimeISO
                        streamingExecution.execution.output.providerTiming.duration =
                          streamEndTime - providerStartTime
                      }
                    }
                  )

                  return streamingExecution
                }

                const nextPayload = {
                  ...payload,
                  contents: simplifiedMessages,
                }

                const allForcedToolsUsed =
                  forcedTools.length > 0 && usedForcedTools.length === forcedTools.length

                if (allForcedToolsUsed && request.responseFormat) {
                  nextPayload.tools = undefined
                  nextPayload.toolConfig = undefined

                  const responseFormatSchema =
                    request.responseFormat.schema || request.responseFormat
                  const cleanSchema = cleanSchemaForGemini(responseFormatSchema)

                  if (!nextPayload.generationConfig) {
                    nextPayload.generationConfig = {}
                  }
                  nextPayload.generationConfig.responseMimeType = 'application/json'
                  nextPayload.generationConfig.responseSchema = cleanSchema

                  logger.info(
                    'Using structured output for final non-streaming response after tool execution'
                  )
                } else {
                  if (currentToolConfig) {
                    nextPayload.toolConfig = currentToolConfig
                  }
                }

                const nextResponse = await fetch(
                  `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent?key=${request.apiKey}`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(nextPayload),
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

                timeSegments.push({
                  type: 'model',
                  name: `Model response (iteration ${iterationCount + 1})`,
                  startTime: nextModelStartTime,
                  endTime: nextModelEndTime,
                  duration: thisModelTime,
                })

                modelTime += thisModelTime

                const nextCandidate = geminiResponse.candidates?.[0]
                const nextFunctionCall = extractFunctionCall(nextCandidate)

                if (!nextFunctionCall) {
                  // If responseFormat is specified, make one final request with structured output
                  if (request.responseFormat) {
                    const finalPayload = {
                      ...payload,
                      contents: nextPayload.contents,
                      tools: undefined,
                      toolConfig: undefined,
                    }

                    const responseFormatSchema =
                      request.responseFormat.schema || request.responseFormat
                    const cleanSchema = cleanSchemaForGemini(responseFormatSchema)

                    if (!finalPayload.generationConfig) {
                      finalPayload.generationConfig = {}
                    }
                    finalPayload.generationConfig.responseMimeType = 'application/json'
                    finalPayload.generationConfig.responseSchema = cleanSchema

                    logger.info('Making final request with structured output after tool execution')

                    const finalResponse = await fetch(
                      `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent?key=${request.apiKey}`,
                      {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(finalPayload),
                      }
                    )

                    if (finalResponse.ok) {
                      const finalResult = await finalResponse.json()
                      const finalCandidate = finalResult.candidates?.[0]
                      content = extractTextContent(finalCandidate)

                      if (finalResult.usageMetadata) {
                        tokens.prompt += finalResult.usageMetadata.promptTokenCount || 0
                        tokens.completion += finalResult.usageMetadata.candidatesTokenCount || 0
                        tokens.total +=
                          (finalResult.usageMetadata.promptTokenCount || 0) +
                          (finalResult.usageMetadata.candidatesTokenCount || 0)

                        const iterationCost = calculateCost(
                          request.model,
                          finalResult.usageMetadata.promptTokenCount || 0,
                          finalResult.usageMetadata.candidatesTokenCount || 0
                        )
                        cost.input += iterationCost.input
                        cost.output += iterationCost.output
                        cost.total += iterationCost.total
                      }
                    } else {
                      logger.warn(
                        'Failed to get structured output, falling back to regular response'
                      )
                      content = extractTextContent(nextCandidate)
                    }
                  } else {
                    content = extractTextContent(nextCandidate)
                  }
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
          content = extractTextContent(candidate)
        }
      } catch (error) {
        logger.error('Error processing Gemini response:', {
          error: error instanceof Error ? error.message : String(error),
          iterationCount,
        })

        if (!content && toolCalls.length > 0) {
          content = `Tool call(s) executed: ${toolCalls.map((t) => t.name).join(', ')}. Results are available in the tool results.`
        }
      }

      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

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
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      logger.error('Error in Google Gemini request:', {
        error: error instanceof Error ? error.message : String(error),
        duration: totalDuration,
      })

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
