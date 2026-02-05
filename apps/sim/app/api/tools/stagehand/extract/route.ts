import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { env } from '@/lib/core/config/env'
import { validateUrlWithDNS } from '@/lib/core/security/input-validation.server'
import { ensureZodObject, normalizeUrl } from '@/app/api/tools/stagehand/utils'

const logger = createLogger('StagehandExtractAPI')

type StagehandType = import('@browserbasehq/stagehand').Stagehand

const BROWSERBASE_API_KEY = env.BROWSERBASE_API_KEY
const BROWSERBASE_PROJECT_ID = env.BROWSERBASE_PROJECT_ID

const requestSchema = z.object({
  instruction: z.string(),
  schema: z.record(z.any()),
  useTextExtract: z.boolean().optional().default(false),
  selector: z.string().nullable().optional(),
  provider: z.enum(['openai', 'anthropic']).optional().default('openai'),
  apiKey: z.string(),
  url: z.string().url(),
})

export async function POST(request: NextRequest) {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  let stagehand: StagehandType | null = null

  try {
    const body = await request.json()
    logger.info('Received extraction request', {
      url: body.url,
      hasInstruction: !!body.instruction,
      schema: body.schema ? typeof body.schema : 'none',
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
    const { url: rawUrl, instruction, selector, provider, apiKey, schema } = params
    const url = normalizeUrl(rawUrl)
    const urlValidation = await validateUrlWithDNS(url, 'url')
    if (!urlValidation.isValid) {
      return NextResponse.json({ error: urlValidation.error }, { status: 400 })
    }

    logger.info('Starting Stagehand extraction process', {
      rawUrl,
      url,
      hasInstruction: !!instruction,
      schemaType: typeof schema,
    })

    if (!schema || typeof schema !== 'object') {
      logger.error('Invalid schema format', { schema })
      return NextResponse.json(
        { error: 'Invalid schema format. Schema must be a valid JSON object.' },
        { status: 400 }
      )
    }

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

    try {
      const modelName =
        provider === 'anthropic' ? 'anthropic/claude-3-7-sonnet-latest' : 'openai/gpt-4.1'

      logger.info('Initializing Stagehand with Browserbase (v3)', { provider, modelName })

      const { Stagehand } = await import('@browserbasehq/stagehand')

      stagehand = new Stagehand({
        env: 'BROWSERBASE',
        apiKey: BROWSERBASE_API_KEY,
        projectId: BROWSERBASE_PROJECT_ID,
        verbose: 1,
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

      logger.info(`Navigating to ${url}`)
      await page.goto(url, { waitUntil: 'networkidle' })
      logger.info('Navigation complete')

      logger.info('Preparing extraction schema', {
        schema: `${JSON.stringify(schema).substring(0, 100)}...`,
      })

      logger.info('Extracting data with Stagehand')

      try {
        const schemaToConvert = schema.schema || schema

        let zodSchema
        try {
          logger.info('Creating Zod schema from JSON schema', {
            schemaType: typeof schemaToConvert,
            hasNestedSchema: !!schema.schema,
          })

          zodSchema = ensureZodObject(logger, schemaToConvert)

          logger.info('Successfully created Zod schema')
        } catch (schemaError) {
          logger.error('Failed to convert JSON schema to Zod schema', {
            error: schemaError,
            message: schemaError instanceof Error ? schemaError.message : 'Unknown schema error',
          })

          logger.info('Falling back to simple extraction without schema')
          zodSchema = undefined
        }

        logger.info('Calling stagehand.extract with options', {
          hasInstruction: !!instruction,
          hasSchema: !!zodSchema,
          hasSelector: !!selector,
        })

        let extractedData
        if (zodSchema) {
          extractedData = await stagehand.extract(instruction, zodSchema, {
            selector: selector || undefined,
          })
        } else {
          extractedData = await stagehand.extract(instruction)
        }

        logger.info('Extraction successful', {
          hasData: !!extractedData,
          dataType: typeof extractedData,
          dataKeys: extractedData ? Object.keys(extractedData) : [],
        })

        return NextResponse.json({
          data: extractedData,
          schema,
        })
      } catch (extractError) {
        logger.error('Error during extraction operation', {
          error: extractError,
          message:
            extractError instanceof Error ? extractError.message : 'Unknown extraction error',
        })
        throw extractError
      }
    } catch (error) {
      logger.error('Stagehand extraction error', {
        error,
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      })

      let errorMessage = 'Unknown error during extraction'
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
    logger.error('Unexpected error in extraction API route', {
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
