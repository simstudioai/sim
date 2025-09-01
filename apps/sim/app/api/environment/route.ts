import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { decryptSecret, encryptSecret } from '@/lib/utils'
import { db } from '@/db'
import { environment } from '@/db/schema'
import type { EnvironmentVariable } from '@/stores/settings/environment/types'

const logger = createLogger('EnvironmentAPI')

// Schema for environment variable updates
const EnvVarSchema = z.object({
  variables: z.record(z.string()),
})

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized environment variables update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      const { variables } = EnvVarSchema.parse(body)

      // Encrypt all variables
      const encryptedVariables = await Promise.all(
        Object.entries(variables).map(async ([key, value]) => {
          const { encrypted } = await encryptSecret(value)
          return [key, encrypted] as const
        })
      ).then((entries) => Object.fromEntries(entries))

      // Replace all environment variables for user
      await db
        .insert(environment)
        .values({
          id: crypto.randomUUID(),
          userId: session.user.id,
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

      return NextResponse.json({ success: true })
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
  } catch (error) {
    logger.error(`[${requestId}] Error updating environment variables`, error)
    return NextResponse.json({ error: 'Failed to update environment variables' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    // Get the session directly in the API route
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized environment variables access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const result = await db
      .select()
      .from(environment)
      .where(eq(environment.userId, userId))
      .limit(1)

    if (!result.length || !result[0].variables) {
      return NextResponse.json({ data: {} }, { status: 200 })
    }

    // Decrypt the variables for client-side use
    const encryptedVariables = result[0].variables as Record<string, string>
    const decryptedVariables: Record<string, EnvironmentVariable> = {}

    // Decrypt each variable
    for (const [key, encryptedValue] of Object.entries(encryptedVariables)) {
      try {
        const { decrypted } = await decryptSecret(encryptedValue)
        decryptedVariables[key] = { key, value: decrypted }
      } catch (error) {
        logger.error(`[${requestId}] Error decrypting variable ${key}`, error)
        // If decryption fails, provide a placeholder
        decryptedVariables[key] = { key, value: '' }
      }
    }

    return NextResponse.json({ data: decryptedVariables }, { status: 200 })
  } catch (error: any) {
    logger.error(`[${requestId}] Environment fetch error`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
