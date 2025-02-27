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

      // Use executeTool with skipProxy=true to prevent recursive proxy calls
      const result = await executeTool(toolId, params, true)

      if (!result.success) {
        throw new Error(
          tool.transformError ? tool.transformError(result) : 'Tool returned an error'
        )
      }

      return NextResponse.json(result)
    } catch (error: any) {
      throw error
    }
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || 'Unknown error',
    })
  }
}
