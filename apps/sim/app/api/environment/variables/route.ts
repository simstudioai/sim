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

const EnvVarSchema = z.object({
  variables: z.record(z.string()),
})

export async function PUT(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const body = await request.json()
    const { workflowId, variables } = body

    const userId = await getUserId(requestId, workflowId)

    if (!userId) {
      logger.warn(`[${requestId}] Unauthorized environment variables set attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
      const { variables: validatedVariables } = EnvVarSchema.parse({ variables })

      const existingData = await db
        .select()
        .from(environment)
        .where(eq(environment.userId, userId))
        .limit(1)

      const existingEncryptedVariables =
        (existingData[0]?.variables as Record<string, string>) || {}

      const variablesToEncrypt: Record<string, string> = {}
      const addedVariables: string[] = []
      const updatedVariables: string[] = []

      for (const [key, newValue] of Object.entries(validatedVariables)) {
        if (!(key in existingEncryptedVariables)) {
          variablesToEncrypt[key] = newValue
          addedVariables.push(key)
        } else {
          try {
            const { decrypted: existingValue } = await decryptSecret(
              existingEncryptedVariables[key]
            )

            if (existingValue !== newValue) {
              variablesToEncrypt[key] = newValue
              updatedVariables.push(key)
            }
          } catch (decryptError) {
            logger.warn(
              `[${requestId}] Could not decrypt existing variable ${key}, re-encrypting`,
              {
                error: decryptError,
              }
            )
            variablesToEncrypt[key] = newValue
            updatedVariables.push(key)
          }
        }
      }

      const newlyEncryptedVariables = await Promise.all(
        Object.entries(variablesToEncrypt).map(async ([key, value]) => {
          const { encrypted } = await encryptSecret(value)
          return [key, encrypted] as const
        })
      ).then((entries) => Object.fromEntries(entries))

      const finalEncryptedVariables = { ...existingEncryptedVariables, ...newlyEncryptedVariables }

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

    const userId = await getUserId(requestId, workflowId)

    if (!userId) {
      logger.warn(`[${requestId}] Unauthorized environment variables access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
