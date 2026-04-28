import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { normalizeEmail } from '@/lib/invitations/core'
import {
  createWorkspaceInvitation,
  prepareWorkspaceInvitationContext,
  WorkspaceInvitationError,
  type WorkspaceInvitationResult,
} from '@/lib/invitations/workspace-invitations'
import { InvitationsNotAllowedError } from '@/ee/access-control/utils/permission-check'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceInvitationBatchAPI')

interface BatchInvitationFailure {
  email: string
  error: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function batchErrorResponse(error: unknown) {
  if (error instanceof WorkspaceInvitationError) {
    return NextResponse.json(
      {
        error: error.message,
        ...(error.email ? { email: error.email } : {}),
        ...(error.upgradeRequired !== undefined ? { upgradeRequired: error.upgradeRequired } : {}),
      },
      { status: error.status }
    )
  }

  if (error instanceof InvitationsNotAllowedError) {
    return NextResponse.json({ error: error.message }, { status: 403 })
  }

  logger.error('Error creating workspace invitation batch:', error)
  return NextResponse.json({ error: 'Failed to create invitation batch' }, { status: 500 })
}

export const POST = withRouteHandler(async (req: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = (await req.json()) as { workspaceId?: unknown; invitations?: unknown }
    if (typeof body.workspaceId !== 'string' || body.workspaceId.length === 0) {
      return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 })
    }

    if (!Array.isArray(body.invitations) || body.invitations.length === 0) {
      return NextResponse.json({ error: 'At least one invitation is required' }, { status: 400 })
    }

    const context = await prepareWorkspaceInvitationContext({
      workspaceId: body.workspaceId,
      inviterId: session.user.id,
      inviterName: session.user.name || session.user.email || 'A user',
      inviterEmail: session.user.email,
    })

    const successful: string[] = []
    const failed: BatchInvitationFailure[] = []
    const invitations: WorkspaceInvitationResult[] = []
    const seenEmails = new Set<string>()

    for (const item of body.invitations) {
      if (!isRecord(item) || typeof item.email !== 'string') {
        return NextResponse.json(
          { error: 'Each invitation must include an email' },
          { status: 400 }
        )
      }

      if (item.permission !== undefined && typeof item.permission !== 'string') {
        return NextResponse.json(
          { error: 'Invitation permission must be a string when provided' },
          { status: 400 }
        )
      }

      const normalizedEmail = normalizeEmail(item.email)
      if (seenEmails.has(normalizedEmail)) {
        failed.push({
          email: normalizedEmail,
          error: `${normalizedEmail} appears more than once in this invitation batch`,
        })
        continue
      }
      seenEmails.add(normalizedEmail)

      try {
        const invitation = await createWorkspaceInvitation({
          context,
          email: item.email,
          permission: item.permission,
          request: req,
        })
        successful.push(invitation.email)
        invitations.push(invitation)
      } catch (error) {
        if (error instanceof WorkspaceInvitationError) {
          failed.push({ email: error.email ?? normalizedEmail, error: error.message })
          continue
        }

        logger.error('Unexpected workspace invitation batch item failure:', {
          email: normalizedEmail,
          error,
        })
        throw error
      }
    }

    return NextResponse.json({
      success: failed.length === 0,
      successful,
      failed,
      invitations,
    })
  } catch (error) {
    return batchErrorResponse(error)
  }
})
