import { createLogger } from '@/lib/logs/console-logger'
import { executeTool } from '@/tools'
import { ProviderConfig, ProviderRequest, ProviderResponse, TimeSegment } from '../types'
import { StreamingExecution } from '@/executor/types'

const logger = createLogger('Google Provider')

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
            controller.close()
            break
          }
          
          const text = new TextDecoder().decode(value)
          buffer += text
          
          try {
            const lines = buffer.split('\n')
            buffer = ''
            
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i].trim()
              
              if (i === lines.length - 1 && line !== '') {
                buffer = line
                continue
              }
              
              if (!line) continue
              
              if (line.startsWith('data: ')) {
                const jsonStr = line.substring(6)
                
                if (jsonStr === '[DONE]') continue
                
                try {
                  const data = JSON.parse(jsonStr)
                  const candidate = data.candidates?.[0]
                  if (candidate?.content?.parts) {
                    const content = extractTextContent(candidate)
                    if (content) {
                      controller.enqueue(new TextEncoder().encode(content))
                    }
                  }
                } catch (e) {
                  logger.error('Error parsing Gemini SSE JSON data', {
                    error: e instanceof Error ? e.message : String(e),
                    data: jsonStr
                  })
                }
              }
            }
          } catch (e) {
            logger.error('Error processing Gemini SSE stream', {
              error: e instanceof Error ? e.message : String(e),
              chunk: text
            })
          }
        }
      } catch (e) {
        logger.error('Error reading Google Gemini stream', {
          error: e instanceof Error ? e.message : String(e)
        })
        controller.error(e)
      }
    },
    async cancel() {
      await reader.cancel()
    }
  })
}

export const googleProvider: ProviderConfig = {
  id: 'google',
  name: 'Google',
  description: "Google's Gemini models",
  version: '1.0.0',
  models: ['gemini-2.5-pro-exp-03-25', 'gemini-2.5-flash-preview-04-17'],
  defaultModel: 'gemini-2.5-pro-exp-03-25',

  executeRequest: async (request: ProviderRequest): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Google Gemini')
    }

    logger.info('Preparing Google Gemini request', {
      model: request.model || 'gemini-2.5-pro-exp-03-25',
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
      
      const requestedModel = request.model || 'gemini-2.5-pro-exp-03-25'
      
      // Build request payload
      const payload: any = {
        contents,
        generationConfig: {}
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
          mimeType: 'application/json'
        })
      }
      
      // Add tools if provided
      if (tools?.length) {
        payload.tools = [{
          functionDeclarations: tools
        }]
        
        logger.info(`Google Gemini request with tools:`, {
          toolCount: tools.length,
          model: requestedModel,
          tools: tools.map(t => t.name)
        })
      }

      // Make the API request
      const initialCallTime = Date.now()
      
      // For streaming requests, add the alt=sse parameter to the URL
      const endpoint = request.stream 
        ? `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent?key=${request.apiKey}&alt=sse` 
        : `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent?key=${request.apiKey}`
      
      const response = await fetch(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      )

      if (!response.ok) {
        const responseText = await response.text()
        logger.error('Gemini API error details:', { 
          status: response.status, 
          statusText: response.statusText,
          responseBody: responseText
        })
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`)
      }

      const firstResponseTime = Date.now() - initialCallTime
      
      // Handle streaming response
      if (request.stream) {
        logger.info('Handling Google Gemini streaming response')
        
        // Create a ReadableStream from the Google Gemini stream
        const stream = createReadableStreamFromGeminiStream(response)
        
        // Create an object that combines the stream with execution metadata
        const streamingExecution: StreamingExecution = {
          stream,
          execution: {
            success: true,
            output: {
              response: {
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
                  timeSegments: [{
                    type: 'model',
                    name: 'Initial streaming response',
                    startTime: initialCallTime,
                    endTime: initialCallTime + firstResponseTime,
                    duration: firstResponseTime,
                  }],
                  cost: {
                    total: 0.0, // Initial estimate, updated as tokens are processed
                    input: 0.0,
                    output: 0.0
                  }
                }
              }
            },
            logs: [],
            metadata: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: firstResponseTime,
            },
            isStreaming: true
          }
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
          } catch (e) {
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
      let toolCalls = []
      let toolResults = []
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
            
            logger.info(`Processing function call: ${latestFunctionCall.name} (iteration ${iterationCount + 1}/${MAX_ITERATIONS})`)
            
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
              
              // First, identify parameters marked as requiredForToolCall
              const requiredToolCallParams: Record<string, any> = {}
              if (tool.params) {
                Object.entries(tool.params).forEach(([key, value]) => {
                  // Check if this parameter is marked as requiredForToolCall
                  if (value?.requiredForToolCall) {
                    requiredToolCallParams[key] = value
                  }
                })
              }
              
              // Execute the tool
              const toolCallStartTime = Date.now()
              
              // Merge arguments in the correct order of precedence:
              // 1. Default parameters from tool.params
              // 2. Arguments from the model's function call (toolArgs)
              // 3. Parameters marked as requiredForToolCall (these should always be preserved)
              // 4. Workflow context if needed
              const mergedArgs = {
                ...tool.params,          // Default parameters defined for the tool
                ...toolArgs,             // Arguments from the model's function call
                ...requiredToolCallParams, // Required parameters from the tool definition (take precedence)
                ...(request.workflowId ? { _context: { workflowId: request.workflowId } } : {}),
              }
              
              // For debugging only - don't log actual API keys
              logger.debug(`Executing tool ${toolName} with parameters:`, { 
                parameterKeys: Object.keys(mergedArgs),
                hasRequiredParams: Object.keys(requiredToolCallParams).length > 0,
                requiredParamKeys: Object.keys(requiredToolCallParams),
              })
              
              const result = await executeTool(toolName, mergedArgs)
              const toolCallEndTime = Date.now()
              const toolCallDuration = toolCallEndTime - toolCallStartTime
              
              if (!result.success) {
                // Check for API key related errors
                const errorMessage = result.error?.toLowerCase() || ''
                if (errorMessage.includes('api key') || errorMessage.includes('apikey') || 
                    errorMessage.includes('x-api-key') || errorMessage.includes('authentication')) {
                  logger.error(`Tool ${toolName} failed with API key error:`, {
                    error: result.error,
                    toolRequiresKey: true
                  })
                  
                  // Add a more helpful error message for the user
                  content = `Error: The ${toolName} tool requires a valid API key. Please ensure you've provided the correct API key for this specific service.`
                } else {
                  // Regular error handling
                  logger.warn(`Tool ${toolName} execution failed`, { 
                    error: result.error,
                    duration: toolCallDuration
                  })
                }
                break
              }
              
              // Add to time segments
              timeSegments.push({
                type: 'tool',
                name: toolName,
                startTime: toolCallStartTime,
                endTime: toolCallEndTime,
                duration: toolCallDuration,
              })
              
              // Track results
              toolResults.push(result.output)
              toolCalls.push({
                name: toolName,
                arguments: toolArgs,
                startTime: new Date(toolCallStartTime).toISOString(),
                endTime: new Date(toolCallEndTime).toISOString(),
                duration: toolCallDuration,
                result: result.output,
              })
              
              // Prepare for next request with simplified messages
              // Use simple format: original query + most recent function call + result
              const simplifiedMessages = [
                // Original user request - find the first user request
                ...(contents.filter(m => m.role === 'user').length > 0 
                  ? [contents.filter(m => m.role === 'user')[0]] 
                  : [contents[0]]),
                // Function call from model
                {
                  role: 'model',
                  parts: [{ 
                    functionCall: {
                      name: latestFunctionCall.name,
                      args: latestFunctionCall.args
                    }
                  }]
                },
                // Function response - but use USER role since Gemini only accepts user or model
                {
                  role: 'user',
                  parts: [{ 
                    text: `Function ${latestFunctionCall.name} result: ${JSON.stringify(toolResults[toolResults.length - 1])}`
                  }]
                }
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
                    tool_config: { mode: 'AUTO' }, // Always use AUTO mode for streaming after tools
                  }
                  
                  // Remove any forced tool configuration to prevent issues with streaming
                  if ('tool_config' in streamingPayload) {
                    streamingPayload.tool_config = { mode: 'AUTO' };
                  }
                  
                  // Make the streaming request with alt=sse parameter
                  const streamingResponse = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent?key=${request.apiKey}&alt=sse`,
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
                      responseBody: errorBody
                    })
                    throw new Error(`Gemini API streaming error: ${streamingResponse.status} ${streamingResponse.statusText}`)
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
                        response: {
                          content: '',
                          model: request.model,
                          tokens,
                          toolCalls: toolCalls.length > 0 ? { 
                            list: toolCalls,
                            count: toolCalls.length 
                          } : undefined,
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
                            total: (tokens.total || 0) * 0.0001,  // Estimate cost based on tokens
                            input: (tokens.prompt || 0) * 0.0001,
                            output: (tokens.completion || 0) * 0.0001
                          }
                        }
                      },
                      logs: [],
                      metadata: {
                        startTime: providerStartTimeISO,
                        endTime: new Date().toISOString(),
                        duration: Date.now() - providerStartTime,
                      },
                      isStreaming: true
                    }
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
                      contents: simplifiedMessages
                    }),
                  }
                )
                
                if (!nextResponse.ok) {
                  const errorBody = await nextResponse.text()
                  logger.error('Error in Gemini follow-up request:', { 
                    status: nextResponse.status,
                    statusText: nextResponse.statusText,
                    responseBody: errorBody,
                    iterationCount
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
                  iterationCount
                })
                break
              }
            } catch (error) {
              logger.error('Error processing function call:', { 
                error: error instanceof Error ? error.message : String(error),
                functionName: latestFunctionCall?.name || 'unknown'
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
          iterationCount 
        })
        
        // Don't rethrow, so we can still return partial results
        if (!content && toolCalls.length > 0) {
          content = `Tool call(s) executed: ${toolCalls.map(t => t.name).join(', ')}. Results are available in the tool results.`
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
          total: (geminiResponse.usageMetadata.promptTokenCount || 0) + 
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
    return schema.map(item => cleanSchemaForGemini(item))
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
        return text      // Return valid JSON as-is
      } catch (e) { /* Not valid JSON, continue with normal extraction */ }
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
function extractFunctionCall(candidate: any): { name: string, args: any } | null {
  if (!candidate?.content?.parts) return null
  
  // Check for functionCall in parts
  for (const part of candidate.content.parts) {
    if (part.functionCall) {
      const args = part.functionCall.args || {}
      // Parse string args if they look like JSON
      if (typeof part.functionCall.args === 'string' && part.functionCall.args.trim().startsWith('{')) {
        try {
          return { name: part.functionCall.name, args: JSON.parse(part.functionCall.args) }
        } catch (e) {
          return { name: part.functionCall.name, args: part.functionCall.args }
        }
      }
      return { name: part.functionCall.name, args }
    }
  }
  
  // Check for alternative function_call format
  if (candidate.content.function_call) {
    const args = typeof candidate.content.function_call.arguments === 'string' 
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
  contents: any[],
  tools: any[] | undefined,
  systemInstruction: any | undefined
} {
  const contents = []
  let systemInstruction = undefined
  
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
          const functionCalls = message.tool_calls.map(toolCall => ({
            functionCall: {
              name: toolCall.function?.name,
              args: JSON.parse(toolCall.function?.arguments || '{}')
            }
          }))
          
          contents.push({ role: 'model', parts: functionCalls })
        }
      } else if (message.role === 'tool') {
        // Convert tool response (Gemini only accepts user/model roles)
        contents.push({
          role: 'user',
          parts: [{ text: `Function result: ${message.content}` }]
        })
      }
    }
  }
  
  // Convert tools to Gemini function declarations
  const tools = request.tools?.map(tool => {
    const toolParameters = { ...(tool.parameters || {}) }
    
    // Process schema properties
    if (toolParameters.properties) {
      const properties = { ...toolParameters.properties }
      let required = toolParameters.required ? [...toolParameters.required] : []
      
      // Remove defaults and optional parameters
      for (const key in properties) {
        const prop = properties[key] as any
        
        if (prop.default !== undefined) {
          const { default: _, ...cleanProp } = prop
          properties[key] = cleanProp
        }
        
        if (tool.params?.[key]?.requiredForToolCall && required.includes(key)) {
          required = required.filter(r => r !== key)
        }
      }
      
      // Build Gemini-compatible parameters schema
      const parameters = {
        type: toolParameters.type || "object",
        properties,
        ...(required.length > 0 ? { required } : {})
      }
      
      // Clean schema for Gemini
      return {
        name: tool.id,
        description: tool.description || `Execute the ${tool.id} function`,
        parameters: cleanSchemaForGemini(parameters)
      }
    }
    
    // Simple schema case
    return {
      name: tool.id,
      description: tool.description || `Execute the ${tool.id} function`,
      parameters: cleanSchemaForGemini(toolParameters)
    }
  })
  
  return { contents, tools, systemInstruction }
}
