import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getEnvironmentVariableKeys } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { decryptSecret, encryptSecret } from '@/lib/utils'
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

      // Start with existing encrypted variables or empty object
      const existingEncryptedVariables =
        (existingData[0]?.variables as Record<string, string>) || {}

      // Determine which variables are new or changed by comparing with decrypted existing values
      const variablesToEncrypt: Record<string, string> = {}
      const addedVariables: string[] = []
      const updatedVariables: string[] = []

      for (const [key, newValue] of Object.entries(validatedVariables)) {
        if (!(key in existingEncryptedVariables)) {
          // New variable
          variablesToEncrypt[key] = newValue
          addedVariables.push(key)
        } else {
          // Check if the value has actually changed by decrypting the existing value
          try {
            const { decrypted: existingValue } = await decryptSecret(
              existingEncryptedVariables[key]
            )

            if (existingValue !== newValue) {
              // Value changed, needs re-encryption
              variablesToEncrypt[key] = newValue
              updatedVariables.push(key)
            }
            // If values are the same, keep the existing encrypted value
          } catch (decryptError) {
            // If we can't decrypt the existing value, treat as changed and re-encrypt
            logger.warn(
              `[${requestId}] Could not decrypt existing variable ${key}, re-encrypting`,
              { error: decryptError }
            )
            variablesToEncrypt[key] = newValue
            updatedVariables.push(key)
          }
        }
      }

      // Only encrypt the variables that are new or changed
      const newlyEncryptedVariables = await Object.entries(variablesToEncrypt).reduce(
        async (accPromise, [key, value]) => {
          const acc = await accPromise
          const { encrypted } = await encryptSecret(value)
          return { ...acc, [key]: encrypted }
        },
        Promise.resolve({})
      )

      // Merge existing encrypted variables with newly encrypted ones
      const finalEncryptedVariables = { ...existingEncryptedVariables, ...newlyEncryptedVariables }

      // Update or insert environment variables for user
      await db
        .insert(environment)
        .values({
          id: crypto.randomUUID(),
          userId: userId,
          variables: finalEncryptedVariables,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [environment.userId],
          set: {
            variables: finalEncryptedVariables,
            updatedAt: new Date(),
          },
        })

      return NextResponse.json(
        {
          success: true,
          output: {
            message: `Successfully processed ${Object.keys(validatedVariables).length} environment variable(s): ${addedVariables.length} added, ${updatedVariables.length} updated`,
            variableCount: Object.keys(validatedVariables).length,
            variableNames: Object.keys(validatedVariables),
            totalVariableCount: Object.keys(finalEncryptedVariables).length,
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
