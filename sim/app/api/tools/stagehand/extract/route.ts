import { NextRequest, NextResponse } from 'next/server'
import { Stagehand } from '@browserbasehq/stagehand'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console-logger'
import { ensureZodObject, normalizeUrl } from '../utils'

const logger = createLogger('StagehandExtractAPI')

// Environment variables for Browserbase
const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY
const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID

// Input validation schema
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
    // Parse and validate request body
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

    // Validate schema structure
    if (!schema || typeof schema !== 'object') {
      logger.error('Invalid schema format', { schema })
      return NextResponse.json(
        { error: 'Invalid schema format. Schema must be a valid JSON object.' },
        { status: 400 }
      )
    }

    // Check for required environment variables
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

    // Validate OpenAI API key format
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('sk-')) {
      logger.error('Invalid OpenAI API key format')
      return NextResponse.json({ error: 'Invalid OpenAI API key format' }, { status: 400 })
    }

    try {
      // Initialize Stagehand with Browserbase
      logger.info('Initializing Stagehand with Browserbase')
      stagehand = new Stagehand({
        env: 'BROWSERBASE',
        apiKey: BROWSERBASE_API_KEY,
        projectId: BROWSERBASE_PROJECT_ID,
        verbose: 1,
        // Use a custom logger wrapper that adapts our logger to Stagehand's expected format
        logger: (msg) => logger.info(typeof msg === 'string' ? msg : JSON.stringify(msg)),
        disablePino: true,
        modelName: 'gpt-4o',
        modelClientOptions: {
          apiKey: apiKey, // User's OpenAI API key
        },
      })

      // Initialize Stagehand
      logger.info('Starting stagehand.init()')
      await stagehand.init()
      logger.info('Stagehand initialized successfully')

      // Navigate to the specified URL
      logger.info(`Navigating to ${url}`)
      await stagehand.page.goto(url, { waitUntil: 'networkidle' })
      logger.info('Navigation complete')

      // Prepare for extraction
      logger.info('Preparing extraction schema', {
        schema: JSON.stringify(schema).substring(0, 100) + '...',
      })

      // Extract data using Stagehand with the raw JSON schema
      logger.info('Extracting data with Stagehand')

      try {
        // Convert the JSON schema to a Zod schema
        // First check if the schema has a nested "schema" property (common pattern)
        const schemaToConvert = schema.schema || schema

        // Create a Zod schema from the JSON schema
        let zodSchema
        try {
          logger.info('Creating Zod schema from JSON schema', {
            schemaType: typeof schemaToConvert,
            hasNestedSchema: !!schema.schema,
          })

          // Convert the schema to a Zod schema
          zodSchema = ensureZodObject(logger, schemaToConvert)

          logger.info('Successfully created Zod schema')
        } catch (schemaError) {
          logger.error('Failed to convert JSON schema to Zod schema', {
            error: schemaError,
            message: schemaError instanceof Error ? schemaError.message : 'Unknown schema error',
          })

          // Fall back to simple extraction without schema
          logger.info('Falling back to simple extraction without schema')
          zodSchema = undefined
        }

        // Prepare extraction options
        const extractOptions: any = {
          instruction,
          useTextExtract: !!useTextExtract,
        }

        // Add schema if we have one
        if (zodSchema) {
          extractOptions.schema = zodSchema
        }

        // Add selector if provided
        if (selector) {
          logger.info(`Using selector: ${selector}`)
          extractOptions.selector = selector
        }

        // Get the extracted data
        logger.info('Calling stagehand.page.extract with options', {
          hasInstruction: !!extractOptions.instruction,
          hasSchema: !!extractOptions.schema,
          hasSelector: !!extractOptions.selector,
          useTextExtract: extractOptions.useTextExtract,
        })

        // Call extract based on whether we have a schema or not
        let extractedData
        if (zodSchema) {
          // Use the full options object when we have a schema
          extractedData = await stagehand.page.extract(extractOptions)
        } else {
          // Just pass the instruction when we don't have a schema
          extractedData = await stagehand.page.extract(extractOptions.instruction)
        }

        logger.info('Extraction successful', {
          hasData: !!extractedData,
          dataType: typeof extractedData,
          dataKeys: extractedData ? Object.keys(extractedData) : [],
        })

        // Return the extracted data
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

      // Provide more detailed error information
      let errorMessage = 'Unknown error during extraction'
      let errorDetails: Record<string, any> = {}

      if (error instanceof Error) {
        errorMessage = error.message
        errorDetails = {
          name: error.name,
          stack: error.stack,
        }

        // Log any additional properties that might provide context
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
    // Make sure to clean up Stagehand resources
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
