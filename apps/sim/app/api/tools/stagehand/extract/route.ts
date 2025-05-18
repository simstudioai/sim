import { NextRequest, NextResponse } from 'next/server'
import { Stagehand } from '@browserbasehq/stagehand'
import { z } from 'zod'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import { ensureZodObject, normalizeUrl } from '../utils'

const logger = createLogger('StagehandExtractAPI')

// Environment variables for Browserbase
const BROWSERBASE_API_KEY = env.BROWSERBASE_API_KEY
const BROWSERBASE_PROJECT_ID = env.BROWSERBASE_PROJECT_ID

const requestSchema = z.object({
  instruction: z.string(),
  schema: z.record(z.any()),
  useTextExtract: z.boolean().optional().default(false),
  selector: z.string().nullable().optional(),
  apiKey: z.string(),
  url: z.string().url(),
})

export async function POST(request: NextRequest) {
  let stagehand = null

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
    const { url: rawUrl, instruction, selector, useTextExtract, apiKey, schema } = params
    let url = normalizeUrl(rawUrl)

    logger.info('Starting Stagehand extraction process', {
      rawUrl,
      url,
      hasInstruction: !!instruction,
      useTextExtract: !!useTextExtract,
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

    if (!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('sk-')) {
      logger.error('Invalid OpenAI API key format')
      return NextResponse.json({ error: 'Invalid OpenAI API key format' }, { status: 400 })
    }

    try {
      logger.info('Initializing Stagehand with Browserbase')
      stagehand = new Stagehand({
        env: 'BROWSERBASE',
        apiKey: BROWSERBASE_API_KEY,
        projectId: BROWSERBASE_PROJECT_ID,
        verbose: 1,
        logger: (msg) => logger.info(typeof msg === 'string' ? msg : JSON.stringify(msg)),
        disablePino: true,
        modelName: 'gpt-4o',
        modelClientOptions: {
          apiKey: apiKey,
        },
      })

      logger.info('Starting stagehand.init()')
      await stagehand.init()
      logger.info('Stagehand initialized successfully')

      logger.info(`Navigating to ${url}`)
      await stagehand.page.goto(url, { waitUntil: 'networkidle' })
      logger.info('Navigation complete')

      logger.info('Preparing extraction schema', {
        schema: JSON.stringify(schema).substring(0, 100) + '...',
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

        const extractOptions: any = {
          instruction,
          useTextExtract: !!useTextExtract,
        }

        if (zodSchema) {
          extractOptions.schema = zodSchema
        }

        if (selector) {
          logger.info(`Using selector: ${selector}`)
          extractOptions.selector = selector
        }

        logger.info('Calling stagehand.page.extract with options', {
          hasInstruction: !!extractOptions.instruction,
          hasSchema: !!extractOptions.schema,
          hasSelector: !!extractOptions.selector,
          useTextExtract: extractOptions.useTextExtract,
        })

        let extractedData
        if (zodSchema) {
          extractedData = await stagehand.page.extract(extractOptions)
        } else {
          extractedData = await stagehand.page.extract(extractOptions.instruction)
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
