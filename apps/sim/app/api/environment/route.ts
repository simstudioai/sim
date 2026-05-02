import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { environment } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { savePersonalEnvironmentContract } from '@/lib/api/contracts/environment'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { syncPersonalEnvCredentialsForUser } from '@/lib/credentials/environment'
import type { EnvironmentVariable } from '@/lib/environment/api'

const logger = createLogger('EnvironmentAPI')

export const POST = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized environment variables update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(
      savePersonalEnvironmentContract,
      req,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid environment variables data`, { errors: error.issues })
          return NextResponse.json(
            { error: 'Invalid request data', details: error.issues },
            { status: 400 }
          )
        },
      }
    )
    if (!parsed.success) return parsed.response

    const { variables } = parsed.data.body

    const encryptedVariables = await Promise.all(
      Object.entries(variables).map(async ([key, value]) => {
        const { encrypted } = await encryptSecret(value)
        return [key, encrypted] as const
      })
    ).then((entries) => Object.fromEntries(entries))

    await db
      .insert(environment)
      .values({
        id: generateId(),
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

    await syncPersonalEnvCredentialsForUser({
      userId: session.user.id,
      envKeys: Object.keys(variables),
    })

    recordAudit({
      actorId: session.user.id,
      actorName: session.user.name,
      actorEmail: session.user.email,
      action: AuditAction.ENVIRONMENT_UPDATED,
      resourceType: AuditResourceType.ENVIRONMENT,
      resourceId: session.user.id,
      description: `Updated ${Object.keys(variables).length} personal environment variable(s)`,
      metadata: {
        variableCount: Object.keys(variables).length,
        updatedKeys: Object.keys(variables),
        scope: 'personal',
      },
      request: req,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error(`[${requestId}] Error updating environment variables`, error)
    return NextResponse.json({ error: 'Failed to update environment variables' }, { status: 500 })
  }
})

export const GET = withRouteHandler(async (request: Request) => {
  const requestId = generateRequestId()

  try {
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

    const encryptedVariables = result[0].variables as Record<string, string>

    const decryptedEntries = await Promise.all(
      Object.entries(encryptedVariables).map(async ([key, encryptedValue]) => {
        try {
          const { decrypted } = await decryptSecret(encryptedValue)
          return [key, { key, value: decrypted }] as const
        } catch (error) {
          logger.error(`[${requestId}] Error decrypting variable ${key}`, error)
          return [key, { key, value: '' }] as const
        }
      })
    )
    const decryptedVariables = Object.fromEntries(decryptedEntries) as Record<
      string,
      EnvironmentVariable
    >

    return NextResponse.json({ data: decryptedVariables }, { status: 200 })
  } catch (error: any) {
    logger.error(`[${requestId}] Environment fetch error`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
})
