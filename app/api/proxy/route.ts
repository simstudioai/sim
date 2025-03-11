import { NextResponse } from 'next/server'
import { executeTool, getTool } from '@/tools'
import { validateToolRequest } from '@/tools/utils'

export async function POST(request: Request) {
  try {
    const { toolId, params } = await request.json()

    const tool = getTool(toolId)

    // Validate the tool and its parameters
    validateToolRequest(toolId, tool, params)

    try {
      if (!tool) {
        throw new Error(`Tool not found: ${toolId}`)
      }

      // Use executeTool with skipProxy=true to prevent recursive proxy calls, and skipPostProcess=true to prevent duplicate post-processing
      const result = await executeTool(toolId, params, true, true)

      if (!result.success) {
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

      return NextResponse.json(result)
    } catch (error: any) {
      throw error
    }
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
