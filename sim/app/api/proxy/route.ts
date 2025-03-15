import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { executeTool, getTool } from '@/tools'
import { validateToolRequest } from '@/tools/utils'

const logger = createLogger('ProxyAPI')

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const startTime = new Date()
  const startTimeISO = startTime.toISOString()

  try {
    const { toolId, params } = await request.json()

    logger.debug(`[${requestId}] Proxy request for tool`, {
      toolId,
      hasParams: !!params && Object.keys(params).length > 0,
    })

    const tool = getTool(toolId)

    // Validate the tool and its parameters
    try {
      validateToolRequest(toolId, tool, params)
    } catch (error) {
      logger.warn(`[${requestId}] Tool validation failed`, {
        toolId,
        error: error instanceof Error ? error.message : String(error),
      })

      // Add timing information even to error responses
      const endTime = new Date()
      const endTimeISO = endTime.toISOString()
      const duration = endTime.getTime() - startTime.getTime()

      return NextResponse.json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        startTime: startTimeISO,
        endTime: endTimeISO,
        duration,
      })
    }

    try {
      if (!tool) {
        logger.error(`[${requestId}] Tool not found`, { toolId })
        throw new Error(`Tool not found: ${toolId}`)
      }

      // Use executeTool with skipProxy=true to prevent recursive proxy calls, and skipPostProcess=true to prevent duplicate post-processing
      const result = await executeTool(toolId, params, true, true)

      if (!result.success) {
        logger.warn(`[${requestId}] Tool execution failed`, {
          toolId,
          error: result.error || 'Unknown error',
        })

        if (tool.transformError) {
          try {
            const errorResult = tool.transformError(result)

            // Handle both string and Promise return types
            if (typeof errorResult === 'string') {
              throw new Error(errorResult)
            } else {
              // It's a Promise, await it
              const transformedError = await errorResult
              // If it's a string or has an error property, use it
              if (typeof transformedError === 'string') {
                throw new Error(transformedError)
              } else if (
                transformedError &&
                typeof transformedError === 'object' &&
                'error' in transformedError
              ) {
                throw new Error(transformedError.error || 'Tool returned an error')
              }
              // Fallback
              throw new Error('Tool returned an error')
            }
          } catch (e) {
            if (e instanceof Error) {
              throw e
            }
            throw new Error('Tool returned an error')
          }
        } else {
          throw new Error('Tool returned an error')
        }
      }

      const endTime = new Date()
      const endTimeISO = endTime.toISOString()
      const duration = endTime.getTime() - startTime.getTime()

      // Add explicit timing information directly to the response
      // This will ensure it's passed to the agent block
      const responseWithTimingData = {
        ...result,
        // Add timing data both at root level and in nested timing object
        startTime: startTimeISO,
        endTime: endTimeISO,
        duration,
        timing: {
          startTime: startTimeISO,
          endTime: endTimeISO,
          duration,
        },
      }

      logger.info(`[${requestId}] Tool executed successfully`, {
        toolId,
        duration,
        startTime: startTimeISO,
        endTime: endTimeISO,
      })
      return NextResponse.json(responseWithTimingData)
    } catch (error: any) {
      throw error
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Proxy request failed`, {
      error: error instanceof Error ? error.message : String(error),
    })

    // Add timing information even to error responses
    const endTime = new Date()
    const endTimeISO = endTime.toISOString()
    const duration = endTime.getTime() - startTime.getTime()

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      startTime: startTimeISO,
      endTime: endTimeISO,
      duration,
    })
  }
}
