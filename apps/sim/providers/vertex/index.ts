import { env } from '@/lib/core/config/env'
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
import { buildVertexEndpoint, createReadableStreamFromVertexStream } from '@/providers/vertex/utils'
import { executeTool } from '@/tools'

const logger = createLogger('VertexProvider')

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

            const promptTokens = usage?.promptTokenCount || 0
            const completionTokens = usage?.candidatesTokenCount || 0
            const totalTokens = usage?.totalTokenCount || promptTokens + completionTokens

            streamingResult.execution.output.tokens = {
              prompt: promptTokens,
              completion: completionTokens,
              total: totalTokens,
            }

            const costResult = calculateCost(request.model, promptTokens, completionTokens)
            streamingResult.execution.output.cost = {
              input: costResult.input,
              output: costResult.output,
              total: costResult.total,
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

                      const promptTokens = usage?.promptTokenCount || 0
                      const completionTokens = usage?.candidatesTokenCount || 0
                      const totalTokens = usage?.totalTokenCount || promptTokens + completionTokens

                      const existingTokens = streamingExecution.execution.output.tokens || {
                        prompt: 0,
                        completion: 0,
                        total: 0,
                      }

                      const existingPrompt = existingTokens.prompt || 0
                      const existingCompletion = existingTokens.completion || 0
                      const existingTotal = existingTokens.total || 0

                      streamingExecution.execution.output.tokens = {
                        prompt: existingPrompt + promptTokens,
                        completion: existingCompletion + completionTokens,
                        total: existingTotal + totalTokens,
                      }

                      const accumulatedCost = calculateCost(
                        request.model,
                        existingPrompt,
                        existingCompletion
                      )
                      const streamCost = calculateCost(
                        request.model,
                        promptTokens,
                        completionTokens
                      )
                      streamingExecution.execution.output.cost = {
                        input: accumulatedCost.input + streamCost.input,
                        output: accumulatedCost.output + streamCost.output,
                        total: accumulatedCost.total + streamCost.total,
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

                    const finalEndpoint = buildVertexEndpoint(
                      vertexProject,
                      vertexLocation,
                      requestedModel,
                      false
                    )

                    const finalResponse = await fetch(finalEndpoint, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${request.apiKey}`,
                      },
                      body: JSON.stringify(finalPayload),
                    })

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
      // @ts-ignore
      enhancedError.timing = {
        startTime: providerStartTimeISO,
        endTime: providerEndTimeISO,
        duration: totalDuration,
      }

      throw enhancedError
    }
  },
}
