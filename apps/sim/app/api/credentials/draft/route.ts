import { db } from '@sim/db'
import { pendingCredentialDraft } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, lt } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createCredentialDraftContract } from '@/lib/api/contracts/credentials'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CredentialDraftAPI')

const DRAFT_TTL_MS = 15 * 60 * 1000

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(createCredentialDraftContract, request, {})
    if (!parsed.success) return parsed.response

    const { workspaceId, providerId, displayName, description, credentialId } = parsed.data.body
    const userId = session.user.id

    const workspaceAccess = await checkWorkspaceAccess(workspaceId, userId)
    if (!workspaceAccess.canWrite) {
      return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
    }

    if (credentialId) {
      const access = await getCredentialActorContext(credentialId, userId, { workspaceAccess })
      if (!access.credential || access.credential.workspaceId !== workspaceId || !access.isAdmin) {
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
