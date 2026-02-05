import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { env } from '@/lib/core/config/env'
import { validateUrlWithDNS } from '@/lib/core/security/input-validation.server'
import { isSensitiveKey, REDACTED_MARKER } from '@/lib/core/security/redaction'
import { ensureZodObject, normalizeUrl } from '@/app/api/tools/stagehand/utils'

const logger = createLogger('StagehandAgentAPI')

type StagehandType = import('@browserbasehq/stagehand').Stagehand

const BROWSERBASE_API_KEY = env.BROWSERBASE_API_KEY
const BROWSERBASE_PROJECT_ID = env.BROWSERBASE_PROJECT_ID

const requestSchema = z.object({
  task: z.string().min(1),
  startUrl: z.string().url(),
  outputSchema: z.any(),
  variables: z.any(),
  provider: z.enum(['openai', 'anthropic']).optional().default('openai'),
  apiKey: z.string(),
})

/**
 * Extracts the inner schema object from a potentially nested schema structure
 */
function getSchemaObject(outputSchema: Record<string, any>): Record<string, any> {
  if (outputSchema.schema && typeof outputSchema.schema === 'object') {
    return outputSchema.schema
  }
  return outputSchema
}

/**
 * Formats a schema object as a string for inclusion in agent instructions
 */
function formatSchemaForInstructions(schema: Record<string, any>): string {
  try {
    return JSON.stringify(schema, null, 2)
  } catch (error) {
    logger.error('Error formatting schema for instructions', { error })
    return JSON.stringify(schema)
  }
}

/**
 * Processes variables from various input formats into a standardized key-value object
 */
function processVariables(variables: any): Record<string, string> | undefined {
  if (!variables) return undefined

  let variablesObject: Record<string, string> = {}

  if (Array.isArray(variables)) {
    variables.forEach((item: any) => {
      if (item?.cells?.Key && typeof item.cells.Key === 'string') {
        variablesObject[item.cells.Key] = item.cells.Value || ''
      }
    })
  } else if (typeof variables === 'object' && variables !== null) {
    variablesObject = { ...variables }
  } else if (typeof variables === 'string') {
    try {
      variablesObject = JSON.parse(variables)
    } catch (_e) {
      logger.warn('Failed to parse variables string as JSON', { variables })
      return undefined
    }
  }

  if (Object.keys(variablesObject).length === 0) {
    return undefined
  }

  return variablesObject
}

/**
 * Substitutes variable placeholders in text with their actual values
 * Variables are referenced using %key% syntax
 */
function substituteVariables(text: string, variables: Record<string, string> | undefined): string {
  if (!variables) return text

  let result = text
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `%${key}%`
    result = result.split(placeholder).join(value)
  }
  return result
}

export async function POST(request: NextRequest) {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  let stagehand: StagehandType | null = null

  try {
    const body = await request.json()
    logger.info('Received Stagehand agent request', {
      startUrl: body.startUrl,
      hasTask: !!body.task,
      hasVariables: !!body.variables,
      hasSchema: !!body.outputSchema,
    })

    const validationResult = requestSchema.safeParse(body)

    if (!validationResult.success) {
      logger.error('Invalid request body', { errors: validationResult.error.errors })
      return NextResponse.json(
        { error: 'Invalid request parameters', details: validationResult.error.errors },
        { status: 400 }
      )
    }

    const params = validationResult.data
    const { task, startUrl: rawStartUrl, outputSchema, provider, apiKey } = params
    const variablesObject = processVariables(params.variables)

    const startUrl = normalizeUrl(rawStartUrl)
    const urlValidation = await validateUrlWithDNS(startUrl, 'startUrl')
    if (!urlValidation.isValid) {
      return NextResponse.json({ error: urlValidation.error }, { status: 400 })
    }

    logger.info('Starting Stagehand agent process', {
      rawStartUrl,
      startUrl,
      hasTask: !!task,
      hasVariables: !!variablesObject,
      provider,
    })

    if (!BROWSERBASE_API_KEY || !BROWSERBASE_PROJECT_ID) {
      logger.error('Missing required environment variables', {
        hasBrowserbaseApiKey: !!BROWSERBASE_API_KEY,
        hasBrowserbaseProjectId: !!BROWSERBASE_PROJECT_ID,
      })

      return NextResponse.json(
        { error: 'Server configuration error: Missing required environment variables' },
        { status: 500 }
      )
    }

    if (!apiKey || typeof apiKey !== 'string') {
      logger.error('API key is required')
      return NextResponse.json({ error: 'API key is required' }, { status: 400 })
    }

    if (provider === 'openai' && !apiKey.startsWith('sk-')) {
      logger.error('Invalid OpenAI API key format')
      return NextResponse.json({ error: 'Invalid OpenAI API key format' }, { status: 400 })
    }

    if (provider === 'anthropic' && !apiKey.startsWith('sk-ant-')) {
      logger.error('Invalid Anthropic API key format')
      return NextResponse.json({ error: 'Invalid Anthropic API key format' }, { status: 400 })
    }

    const modelName =
      provider === 'anthropic' ? 'anthropic/claude-3-7-sonnet-latest' : 'openai/gpt-4.1'

    try {
      logger.info('Initializing Stagehand with Browserbase (v3)', { provider, modelName })

      const { Stagehand } = await import('@browserbasehq/stagehand')

      stagehand = new Stagehand({
        env: 'BROWSERBASE',
        apiKey: BROWSERBASE_API_KEY,
        projectId: BROWSERBASE_PROJECT_ID,
        verbose: 1,
        disableAPI: true, // Use local agent handler instead of Browserbase API
        logger: (msg) => logger.info(typeof msg === 'string' ? msg : JSON.stringify(msg)),
        model: {
          modelName,
          apiKey: apiKey,
        },
      })

      logger.info('Starting stagehand.init()')
      await stagehand.init()
      logger.info('Stagehand initialized successfully')

      const page = stagehand.context.pages()[0]
      logger.info(`Navigating to ${startUrl}`)
      await page.goto(startUrl, { waitUntil: 'networkidle' })
      logger.info('Navigation complete')

      const taskWithVariables = substituteVariables(task, variablesObject)

      let agentInstructions = `You are a helpful web browsing assistant. Complete the following task: ${taskWithVariables}`

      if (variablesObject && Object.keys(variablesObject).length > 0) {
        const safeVarKeys = Object.keys(variablesObject).map((key) => {
          return isSensitiveKey(key) ? `${key}: ${REDACTED_MARKER}` : key
        })
        logger.info('Variables available for task', { variables: safeVarKeys })
      }

      if (outputSchema && typeof outputSchema === 'object' && outputSchema !== null) {
        const schemaObj = getSchemaObject(outputSchema)
        agentInstructions += `\n\nIMPORTANT: You MUST return your final result in the following JSON format exactly:\n${formatSchemaForInstructions(schemaObj)}\n\nYour response should consist of valid JSON only, with no additional text.`
      }

      logger.info('Creating Stagehand agent')

      const agent = stagehand.agent({
        model: {
          modelName,
          apiKey: apiKey,
        },
        executionModel: {
          modelName,
          apiKey: apiKey,
        },
        systemPrompt: agentInstructions,
      })

      logger.info('Executing agent task', { task: taskWithVariables })

      const agentExecutionResult = await agent.execute({
        instruction: taskWithVariables,
        maxSteps: 20,
      })

      const agentResult = {
        success: agentExecutionResult.success,
        completed: agentExecutionResult.completed,
        message: agentExecutionResult.message,
        actions: agentExecutionResult.actions,
      }

      logger.info('Agent execution complete', {
        success: agentResult.success,
        completed: agentResult.completed,
        actionCount: agentResult.actions?.length || 0,
      })

      let structuredOutput = null
      const hasOutputSchema =
        outputSchema && typeof outputSchema === 'object' && outputSchema !== null

      if (agentResult.message) {
        try {
          let jsonContent = agentResult.message

          const jsonBlockMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
          if (jsonBlockMatch?.[1]) {
            jsonContent = jsonBlockMatch[1]
          }

          structuredOutput = JSON.parse(jsonContent)
          logger.info('Successfully parsed structured output from agent response')
        } catch (parseError) {
          if (hasOutputSchema) {
            logger.warn('Failed to parse JSON from agent message, attempting fallback extraction', {
              error: parseError,
            })

            if (stagehand) {
              try {
                logger.info('Attempting to extract structured data using Stagehand extract')
                const schemaObj = getSchemaObject(outputSchema)
                const zodSchema = ensureZodObject(logger, schemaObj)

                structuredOutput = await stagehand.extract(
                  'Extract the requested information from this page according to the schema',
                  zodSchema
                )

                logger.info('Successfully extracted structured data as fallback', {
                  keys: structuredOutput ? Object.keys(structuredOutput) : [],
                })
              } catch (extractError) {
                logger.error('Fallback extraction also failed', { error: extractError })
              }
            }
          } else {
            logger.info('Agent returned plain text response (no schema provided)')
          }
        }
      }

      return NextResponse.json({
        agentResult,
        structuredOutput,
      })
    } catch (error) {
      logger.error('Stagehand agent execution error', {
        error,
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      })

      let errorMessage = 'Unknown error during agent execution'
      let errorDetails: Record<string, any> = {}

      if (error instanceof Error) {
        errorMessage = error.message
        errorDetails = {
          name: error.name,
          stack: error.stack,
        }

        const errorObj = error as any
        if (typeof errorObj.code !== 'undefined') {
          errorDetails.code = errorObj.code
        }
        if (typeof errorObj.statusCode !== 'undefined') {
          errorDetails.statusCode = errorObj.statusCode
        }
        if (typeof errorObj.response !== 'undefined') {
          errorDetails.response = errorObj.response
        }
      }

      return NextResponse.json(
        {
          error: errorMessage,
          details: errorDetails,
        },
        { status: 500 }
      )
    }
  } catch (error) {
    logger.error('Unexpected error in agent API route', {
      error,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  } finally {
    if (stagehand) {
      try {
        logger.info('Closing Stagehand instance')
        await stagehand.close()
      } catch (closeError) {
        logger.error('Error closing Stagehand instance', { error: closeError })
      }
    }
  }
}
