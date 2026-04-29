import { db } from '@sim/db'
import { credential, credentialMember, pendingCredentialDraft } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, lt } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { createCredentialDraftBodySchema } from '@/lib/api/contracts/credentials'
import { getValidationErrorMessage, validateJsonBody } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CredentialDraftAPI')

const DRAFT_TTL_MS = 15 * 60 * 1000

export const POST = withRouteHandler(async (request: Request) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateJsonBody(request, createCredentialDraftBodySchema)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error
            ? getValidationErrorMessage(parsed.error, 'Invalid request body')
            : 'Invalid request body',
        },
        { status: 400 }
      )
    }

    const { workspaceId, providerId, displayName, description, credentialId } = parsed.data
    const userId = session.user.id

    const workspaceAccess = await checkWorkspaceAccess(workspaceId, userId)
    if (!workspaceAccess.canWrite) {
      return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
    }

    if (credentialId) {
      const [membership] = await db
        .select({ role: credentialMember.role, status: credentialMember.status })
        .from(credentialMember)
        .innerJoin(credential, eq(credential.id, credentialMember.credentialId))
        .where(
          and(
            eq(credentialMember.credentialId, credentialId),
            eq(credentialMember.userId, userId),
            eq(credentialMember.status, 'active'),
            eq(credentialMember.role, 'admin'),
            eq(credential.workspaceId, workspaceId)
          )
        )
        .limit(1)

      if (!membership) {
        return NextResponse.json(
          { error: 'Admin access required on the target credential' },
          { status: 403 }
        )
      }
    }

    const now = new Date()

    await db
      .delete(pendingCredentialDraft)
      .where(
        and(eq(pendingCredentialDraft.userId, userId), lt(pendingCredentialDraft.expiresAt, now))
      )

    await db
      .insert(pendingCredentialDraft)
      .values({
        id: generateId(),
        userId,
        workspaceId,
        providerId,
        displayName,
        description: description || null,
        credentialId: credentialId || null,
        expiresAt: new Date(now.getTime() + DRAFT_TTL_MS),
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [
          pendingCredentialDraft.userId,
          pendingCredentialDraft.providerId,
          pendingCredentialDraft.workspaceId,
        ],
        set: {
          displayName,
          description: description || null,
          credentialId: credentialId || null,
          expiresAt: new Date(now.getTime() + DRAFT_TTL_MS),
          createdAt: now,
        },
      })

    logger.info('Credential draft saved', {
      userId,
      workspaceId,
      providerId,
      displayName,
      credentialId: credentialId || null,
    })

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error('Failed to save credential draft', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
