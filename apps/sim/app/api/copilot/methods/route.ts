import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console-logger'
import { getBlocksAndTools } from '../get-blocks-and-tools/route'
import { getWorkflowExamples } from '../get-workflow-examples/route'
import { setEnvironmentVariables } from '../set-environment-variables/route'
import { getEnvironmentVariables } from '../get-environment-variables/route'
import { previewWorkflow } from '../preview-workflow/route'
import { docsSearchInternal } from '../docs-search-internal/route'
import { getWorkflowConsole } from '../get-workflow-console/route'
import { getUserWorkflow } from '../get-user-workflow/route'
import { getBlocksMetadata } from '../get-blocks-metadata/route'
import { getYamlStructure } from '../get-yaml-structure/route'
import { targetedUpdates } from '../targeted-updates/route'

const logger = createLogger('CopilotMethodsAPI')

// Schema for method execution
const MethodExecutionSchema = z.object({
  methodId: z.string().min(1, 'Method ID is required'),
  params: z.record(z.any()).optional().default({}),
})

// Simple internal API key authentication
function checkInternalApiKey(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  const expectedApiKey = process.env.INTERNAL_API_KEY
  
  if (!expectedApiKey) {
    return { success: false, error: 'Internal API key not configured' }
  }
  
  if (!apiKey) {
    return { success: false, error: 'API key required' }
  }
  
  if (apiKey !== expectedApiKey) {
    return { success: false, error: 'Invalid API key' }
  }
  
  return { success: true }
}

// Method registry mapping methodId to method
const METHODS = {
  'get_blocks_and_tools': getBlocksAndTools,
  'get_workflow_examples': getWorkflowExamples,
  'set_environment_variables': setEnvironmentVariables,
  'get_environment_variables': getEnvironmentVariables,
  'preview_workflow': previewWorkflow,
  'docs_search_internal': docsSearchInternal,
  'get_workflow_console': getWorkflowConsole,
  'get_user_workflow': getUserWorkflow,
  'get_blocks_metadata': getBlocksMetadata,
  'get_yaml_structure': getYamlStructure,
  'targeted_updates': targetedUpdates,
} as const

/**
 * POST /api/copilot/methods
 * Execute a method based on methodId with internal API key auth
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID()

  try {
    // Check authentication (internal API key)
    const authResult = checkInternalApiKey(req)
    if (!authResult.success) {
      return NextResponse.json({ error: authResult.error }, { status: 401 })
    }

    const body = await req.json()
    const { methodId, params } = MethodExecutionSchema.parse(body)

    logger.info(`[${requestId}] Method execution: ${methodId}`, {
      methodId,
    })

    // Check if method exists
    if (!(methodId in METHODS)) {
      return NextResponse.json(
        { 
          error: `Unknown method: ${methodId}`,
          availableMethods: Object.keys(METHODS)
        }, 
        { status: 400 }
      )
    }

    // Execute the method
    const method = METHODS[methodId as keyof typeof METHODS]
    const result = await method(params)

    logger.info(`[${requestId}] Method execution completed successfully: ${methodId}`)

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Method execution error:`, error)
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Internal server error'
      }, 
      { status: 500 }
    )
  }
} 