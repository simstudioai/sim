import { env } from '@/lib/core/config/env'
import { createLogger } from '@/lib/logs/console/logger'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import type {
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/types'
import {
  prepareToolExecution,
  prepareToolsWithUsageControl,
  trackForcedToolUsage,
} from '@/providers/utils'
import { executeTool } from '@/tools'

const logger = createLogger('VertexProvider')

/**
 * Creates a ReadableStream from Vertex AI's Gemini stream response
 */
function createReadableStreamFromVertexStream(
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
function buildVertexEndpoint(
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

/**
 * Vertex AI provider configuration
 */
export const vertexProvider: ProviderConfig = {
  id: 'vertex',
  name: 'Vertex AI',
  description: "Google's Vertex AI platform for Gemini models",
  version: '1.0.0',
  models: getProviderModels('vertex'),
  defaultModel: getProviderDefaultModel('vertex'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    const vertexProject = env.VERTEX_PROJECT || request.vertexProject
    const vertexLocation = env.VERTEX_LOCATION || request.vertexLocation || 'us-central1'

    if (!vertexProject) {
      throw new Error(
        'Vertex AI project is required. Please provide it via VERTEX_PROJECT environment variable or vertexProject parameter.'
      )
    }

    if (!request.apiKey) {
      throw new Error(
        'Access token is required for Vertex AI. Run `gcloud auth print-access-token` to get one, or use a service account.'
      )
    }

    logger.info('Preparing Vertex AI request', {
      model: request.model || 'vertex/gemini-2.5-pro',
      hasSystemPrompt: !!request.systemPrompt,
      hasMessages: !!request.messages?.length,
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      streaming: !!request.stream,
      project: vertexProject,
      location: vertexLocation,
    })

    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      const { contents, tools, systemInstruction } = convertToGeminiFormat(request)

      const requestedModel = (request.model || 'vertex/gemini-2.5-pro').replace('vertex/', '')

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

        logger.info('Using Vertex AI native structured output format', {
          hasSchema: !!cleanSchema,
          mimeType: 'application/json',
        })
      } else if (request.responseFormat && tools?.length) {
        logger.warn(
          'Vertex AI does not support structured output (responseFormat) with function calling (tools). Structured output will be ignored.'
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

          logger.info('Vertex AI request with tools:', {
            toolCount: filteredTools.length,
            model: requestedModel,
            tools: filteredTools.map((t) => t.name),
            hasToolConfig: !!toolConfig,
            toolConfig: toolConfig,
          })
        }
      }

      const initialCallTime = Date.now()
      const shouldStream = !!(request.stream && !tools?.length)

      const endpoint = buildVertexEndpoint(
        vertexProject,
        vertexLocation,
        requestedModel,
        shouldStream
      )

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
          Authorization: `Bearer ${request.apiKey}`,
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const responseText = await response.text()
        logger.error('Vertex AI API error details:', {
          status: response.status,
          statusText: response.statusText,
          responseBody: responseText,
        })
        throw new Error(`Vertex AI API error: ${response.status} ${response.statusText}`)
      }

      const firstResponseTime = Date.now() - initialCallTime

      if (shouldStream) {
        logger.info('Handling Vertex AI streaming response')

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

        streamingResult.stream = createReadableStreamFromVertexStream(
          response,
          (content, usage) => {
            streamingResult.execution.output.content = content

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

            if (usage) {
              streamingResult.execution.output.tokens = {
                prompt: usage.promptTokenCount || 0,
                completion: usage.candidatesTokenCount || 0,
                total:
                  usage.totalTokenCount ||
                  (usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0),
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
            'Vertex AI returned UNEXPECTED_TOOL_CALL - model attempted to call a tool that was not provided',
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
          logger.info(`Received function call from Vertex AI: ${functionCall.name}`)

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

                  const checkEndpoint = buildVertexEndpoint(
                    vertexProject,
                    vertexLocation,
                    requestedModel,
                    false
                  )

                  const checkResponse = await fetch(checkEndpoint, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${request.apiKey}`,
                    },
                    body: JSON.stringify(checkPayload),
                  })

                  if (!checkResponse.ok) {
                    const errorBody = await checkResponse.text()
                    logger.error('Error in Vertex AI check request:', {
                      status: checkResponse.status,
                      statusText: checkResponse.statusText,
                      responseBody: errorBody,
                    })
                    throw new Error(
                      `Vertex AI API check error: ${checkResponse.status} ${checkResponse.statusText}`
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

                  const streamEndpoint = buildVertexEndpoint(
                    vertexProject,
                    vertexLocation,
                    requestedModel,
                    true
                  )

                  const streamingResponse = await fetch(streamEndpoint, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${request.apiKey}`,
                    },
                    body: JSON.stringify(streamingPayload),
                  })

                  if (!streamingResponse.ok) {
                    const errorBody = await streamingResponse.text()
                    logger.error('Error in Vertex AI streaming follow-up request:', {
                      status: streamingResponse.status,
                      statusText: streamingResponse.statusText,
                      responseBody: errorBody,
                    })
                    throw new Error(
                      `Vertex AI API streaming error: ${streamingResponse.status} ${streamingResponse.statusText}`
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

                  streamingExecution.stream = createReadableStreamFromVertexStream(
                    streamingResponse,
                    (content, usage) => {
                      streamingExecution.execution.output.content = content

                      const streamEndTime = Date.now()
                      const streamEndTimeISO = new Date(streamEndTime).toISOString()

                      if (streamingExecution.execution.output.providerTiming) {
                        streamingExecution.execution.output.providerTiming.endTime =
                          streamEndTimeISO
                        streamingExecution.execution.output.providerTiming.duration =
                          streamEndTime - providerStartTime
                      }

                      if (usage) {
                        const existingTokens = streamingExecution.execution.output.tokens || {
                          prompt: 0,
                          completion: 0,
                          total: 0,
                        }
                        streamingExecution.execution.output.tokens = {
                          prompt: (existingTokens.prompt || 0) + (usage.promptTokenCount || 0),
                          completion:
                            (existingTokens.completion || 0) + (usage.candidatesTokenCount || 0),
                          total:
                            (existingTokens.total || 0) +
                            (usage.totalTokenCount ||
                              (usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0)),
                        }
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

                const nextEndpoint = buildVertexEndpoint(
                  vertexProject,
                  vertexLocation,
                  requestedModel,
                  false
                )

                const nextResponse = await fetch(nextEndpoint, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${request.apiKey}`,
                  },
                  body: JSON.stringify(nextPayload),
                })

                if (!nextResponse.ok) {
                  const errorBody = await nextResponse.text()
                  logger.error('Error in Vertex AI follow-up request:', {
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
                  content = extractTextContent(nextCandidate)
                  break
                }

                iterationCount++
              } catch (error) {
                logger.error('Error in Vertex AI follow-up request:', {
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
        logger.error('Error processing Vertex AI response:', {
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

      logger.error('Error in Vertex AI request:', {
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

/**
 * Helper function to remove additionalProperties from a schema object
 */
function cleanSchemaForGemini(schema: any): any {
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
 * Helper function to extract content from a Gemini response
 */
function extractTextContent(candidate: any): string {
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
 * Helper function to extract a function call from a Gemini response
 */
function extractFunctionCall(candidate: any): { name: string; args: any } | null {
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
 * Convert OpenAI-style request format to Gemini format
 */
function convertToGeminiFormat(request: ProviderRequest): {
  contents: any[]
  tools: any[] | undefined
  systemInstruction: any | undefined
} {
  const contents = []
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
