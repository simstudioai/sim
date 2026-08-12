import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createWorkspaceCredentialContract,
  credentialsListGetQuerySchema,
} from '@/lib/api/contracts/credentials'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { syncWorkspaceOAuthCredentialsForUser } from '@/lib/credentials/oauth'
import {
  performCreateCredential,
  statusForCredentialOrchestrationError,
} from '@/lib/credentials/orchestration/credential-create'
import { listVisibleWorkspaceCredentials } from '@/lib/credentials/queries'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CredentialsAPI')

/**
 * Thrown by the inner duplicate guard inside the create transaction when a
 * concurrent request slipped a row in between the outer existence check and
 * our INSERT. The catch maps this to a 409 with a typed `code` so the UI can
 * map to a friendly message.
 */
class DuplicateCredentialError extends Error {
  constructor() {
    super('duplicate_display_name')
    this.name = 'DuplicateCredentialError'
  }
}

interface ExistingCredentialSourceParams {
  workspaceId: string
  type: 'oauth' | 'env_workspace' | 'env_personal' | 'service_account'
  accountId?: string | null
  envKey?: string | null
  envOwnerUserId?: string | null
  displayName?: string | null
  providerId?: string | null
}

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

async function findExistingCredentialBySourceWith(
  exec: DbOrTx,
  params: ExistingCredentialSourceParams
) {
  const { workspaceId, type, accountId, envKey, envOwnerUserId, displayName, providerId } = params

  if (type === 'oauth' && accountId) {
    const [row] = await exec
      .select()
      .from(credential)
      .where(
        and(
          eq(credential.workspaceId, workspaceId),
          eq(credential.type, 'oauth'),
          eq(credential.accountId, accountId)
        )
      )
      .limit(1)
    return row ?? null
  }

  if (type === 'env_workspace' && envKey) {
    const [row] = await exec
      .select()
      .from(credential)
      .where(
        and(
          eq(credential.workspaceId, workspaceId),
          eq(credential.type, 'env_workspace'),
          eq(credential.envKey, envKey)
        )
      )
      .limit(1)
    return row ?? null
  }

  if (type === 'env_personal' && envKey && envOwnerUserId) {
    const [row] = await exec
      .select()
      .from(credential)
      .where(
        and(
          eq(credential.workspaceId, workspaceId),
          eq(credential.type, 'env_personal'),
          eq(credential.envKey, envKey),
          eq(credential.envOwnerUserId, envOwnerUserId)
        )
      )
      .limit(1)
    return row ?? null
  }

  if (type === 'service_account' && displayName && providerId) {
    const [row] = await exec
      .select()
      .from(credential)
      .where(
        and(
          eq(credential.workspaceId, workspaceId),
          eq(credential.type, 'service_account'),
          eq(credential.providerId, providerId),
          eq(credential.displayName, displayName)
        )
      )
      .limit(1)
    return row ?? null
  }

  return null
}

/**
 * `return await` is load-bearing, not redundant. Next 16.3.0's Turbopack
 * optimizer models a bare `return <asyncCall>()` tail call as returning the
 * promise object, then propagates that always-truthy fact through the caller's
 * `await`. It concludes `if (existingCredential)` is always taken and — because
 * every branch inside that block returns — deletes the entire create path from
 * the emitted bundle, so a first-time create throws on `existingCredential.id`.
 * Awaiting here makes the optimizer model the resolved value instead.
 */
async function findExistingCredentialBySource(params: ExistingCredentialSourceParams) {
  return await findExistingCredentialBySourceWith(db, params)
}

async function findExistingCredentialBySourceTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: ExistingCredentialSourceParams
) {
  return await findExistingCredentialBySourceWith(tx, params)
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const rawWorkspaceId = searchParams.get('workspaceId')
    const rawType = searchParams.get('type')
    const rawProviderId = searchParams.get('providerId')
    const rawCredentialId = searchParams.get('credentialId')
    const parseResult = credentialsListGetQuerySchema.safeParse({
      workspaceId: rawWorkspaceId?.trim(),
      type: rawType?.trim() || undefined,
      providerId: rawProviderId?.trim() || undefined,
      credentialId: rawCredentialId?.trim() || undefined,
    })

    if (!parseResult.success) {
      logger.warn(`[${requestId}] Invalid credential list request`, {
        workspaceId: rawWorkspaceId,
        type: rawType,
        providerId: rawProviderId,
        errors: parseResult.error.issues,
      })
      return NextResponse.json(
        { error: getValidationErrorMessage(parseResult.error) },
        { status: 400 }
      )
    }

    const { workspaceId, type, providerId, credentialId: lookupCredentialId } = parseResult.data
    const workspaceAccess = await checkWorkspaceAccess(workspaceId, session.user.id)

    if (!workspaceAccess.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (lookupCredentialId) {
      let [row] = await db
        .select({
          id: credential.id,
          displayName: credential.displayName,
          type: credential.type,
          providerId: credential.providerId,
        })
        .from(credential)
        .where(and(eq(credential.id, lookupCredentialId), eq(credential.workspaceId, workspaceId)))
        .limit(1)

      if (!row) {
        ;[row] = await db
          .select({
            id: credential.id,
            displayName: credential.displayName,
            type: credential.type,
            providerId: credential.providerId,
          })
          .from(credential)
          .where(
            and(
              eq(credential.accountId, lookupCredentialId),
              eq(credential.workspaceId, workspaceId)
            )
          )
          .limit(1)
      }

      return NextResponse.json({ credential: row ?? null })
    }

    if (!type || type === 'oauth') {
      await syncWorkspaceOAuthCredentialsForUser({ workspaceId, userId: session.user.id })
    }

    const visible = await listVisibleWorkspaceCredentials({
      workspaceId,
      userId: session.user.id,
      workspaceAccess,
      types: type ? [type] : undefined,
      providerId,
    })
    const credentials = visible.map(({ hasServiceAccountKey: _hasKey, ...rest }) => rest)

    return NextResponse.json({ credentials })
  } catch (error) {
    logger.error(`[${requestId}] Failed to list credentials`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(
    createWorkspaceCredentialContract,
    request,
    {},
    {
      validationErrorResponse: (error) =>
        NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
    }
  )
  if (!parsed.success) return parsed.response

  const result = await performCreateCredential({
    ...parsed.data.body,
    userId: session.user.id,
    actorName: session.user.name,
    actorEmail: session.user.email,
    request,
  })

  if (!result.success) {
    logger.warn(`[${requestId}] Credential create rejected`, {
      errorCode: result.errorCode,
      providerErrorCode: result.providerErrorCode,
    })
    const status = statusForCredentialOrchestrationError(result.errorCode, {
      providerUnavailable: result.providerUnavailable,
    })
    return NextResponse.json(
      result.providerErrorCode
        ? { code: result.providerErrorCode, error: result.error }
        : { error: result.error },
      { status }
    )
  }

  if (!result.credential) {
    throw new Error('Credential creation succeeded without a credential')
  }

  const responseBody = createWorkspaceCredentialContract.response.schema.parse({
    credential: {
      ...result.credential,
      createdAt: result.credential.createdAt.toISOString(),
      updatedAt: result.credential.updatedAt.toISOString(),
    },
  })

  // An existing credential matched the source: an idempotent replay, not a create.
  return NextResponse.json(responseBody, { status: result.created ? 201 : 200 })
})
