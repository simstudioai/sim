import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getEnvironmentVariableKeys } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console-logger'
import { encryptSecret } from '@/lib/utils'
import { getUserId } from '@/app/api/auth/oauth/utils'
import { db } from '@/db'
import { environment } from '@/db/schema'

const logger = createLogger('EnvironmentVariablesAPI')

// Schema for environment variable updates
const EnvVarSchema = z.object({
  variables: z.record(z.string()),
})

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    // For GET requests, check for workflowId in query params
    const { searchParams } = new URL(request.url)
    const workflowId = searchParams.get('workflowId')

    // Use dual authentication pattern like other copilot tools
    const userId = await getUserId(requestId, workflowId || undefined)

    if (!userId) {
      logger.warn(`[${requestId}] Unauthorized environment variables access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get only the variable names (keys), not values
    const result = await getEnvironmentVariableKeys(userId)

    return NextResponse.json(
      {
        success: true,
        output: result,
      },
      { status: 200 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Environment variables fetch error`, error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to get environment variables',
      },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const body = await request.json()
    const { workflowId, variables } = body

    // Use dual authentication pattern like other copilot tools
    const userId = await getUserId(requestId, workflowId)

    if (!userId) {
      logger.warn(`[${requestId}] Unauthorized environment variables set attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
      const { variables: validatedVariables } = EnvVarSchema.parse({ variables })

      // Get existing environment variables for this user
      const existingData = await db
        .select()
        .from(environment)
        .where(eq(environment.userId, userId))
        .limit(1)

      // Start with existing variables or empty object
      const existingVariables = (existingData[0]?.variables as Record<string, string>) || {}

      // Merge new variables with existing ones (new variables will override existing ones with same key)
      const mergedVariables = { ...existingVariables, ...validatedVariables }

      // Encrypt all merged variables
      const encryptedVariables = await Object.entries(mergedVariables).reduce(
        async (accPromise, [key, value]) => {
          const acc = await accPromise
          const { encrypted } = await encryptSecret(value)
          return { ...acc, [key]: encrypted }
        },
        Promise.resolve({})
      )

      // Update or insert environment variables for user
      await db
        .insert(environment)
        .values({
          id: crypto.randomUUID(),
          userId: userId,
          variables: encryptedVariables,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [environment.userId],
          set: {
            variables: encryptedVariables,
            updatedAt: new Date(),
          },
        })

      // Determine which variables were added vs updated
      const addedVariables = Object.keys(validatedVariables).filter(
        (key) => !(key in existingVariables)
      )
      const updatedVariables = Object.keys(validatedVariables).filter(
        (key) => key in existingVariables
      )

      return NextResponse.json(
        {
          success: true,
          output: {
            message: `Successfully processed ${Object.keys(validatedVariables).length} environment variable(s): ${addedVariables.length} added, ${updatedVariables.length} updated`,
            variableCount: Object.keys(validatedVariables).length,
            variableNames: Object.keys(validatedVariables),
            totalVariableCount: Object.keys(mergedVariables).length,
            addedVariables,
            updatedVariables,
          },
        },
        { status: 200 }
      )
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid environment variables data`, {
          errors: validationError.errors,
        })
        return NextResponse.json(
          { error: 'Invalid request data', details: validationError.errors },
          { status: 400 }
        )
      }
      throw validationError
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Environment variables set error`, error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to set environment variables',
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const body = await request.json()
    const { workflowId } = body

    // Use dual authentication pattern like other copilot tools
    const userId = await getUserId(requestId, workflowId)

    if (!userId) {
      logger.warn(`[${requestId}] Unauthorized environment variables access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get only the variable names (keys), not values
    const result = await getEnvironmentVariableKeys(userId)

    return NextResponse.json(
      {
        success: true,
        output: result,
      },
      { status: 200 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Environment variables fetch error`, error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to get environment variables',
      },
      { status: 500 }
    )
  }
}
