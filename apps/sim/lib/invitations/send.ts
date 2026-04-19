import { db } from '@sim/db'
import {
  type InvitationKind,
  invitation,
  invitationWorkspaceGrant,
  organization,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  getEmailSubject,
  renderBatchInvitationEmail,
  renderInvitationEmail,
  renderWorkspaceInvitationEmail,
} from '@/components/emails'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { computeInvitationExpiry, normalizeEmail } from '@/lib/invitations/core'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getFromEmailAddress } from '@/lib/messaging/email/utils'

const logger = createLogger('InvitationSend')

export interface WorkspaceGrantInput {
  workspaceId: string
  permission: 'admin' | 'write' | 'read'
}

export interface CreatePendingInvitationInput {
  kind: InvitationKind
  email: string
  inviterId: string
  organizationId: string | null
  role: 'admin' | 'member'
  grants: WorkspaceGrantInput[]
  expiresAt?: Date
}

export interface CreatePendingInvitationResult {
  invitationId: string
  token: string
  expiresAt: Date
}

export async function createPendingInvitation(
  input: CreatePendingInvitationInput
): Promise<CreatePendingInvitationResult> {
  const invitationId = generateId()
  const token = generateId()
  const expiresAt = input.expiresAt ?? computeInvitationExpiry()
  const now = new Date()

  await db.transaction(async (tx) => {
    await tx.insert(invitation).values({
      id: invitationId,
      kind: input.kind,
      email: normalizeEmail(input.email),
      inviterId: input.inviterId,
      organizationId: input.organizationId,
      role: input.role,
      status: 'pending',
      token,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })

    for (const grant of input.grants) {
      await tx.insert(invitationWorkspaceGrant).values({
        id: generateId(),
        invitationId,
        workspaceId: grant.workspaceId,
        permission: grant.permission,
        createdAt: now,
        updatedAt: now,
      })
    }
  })

  return { invitationId, token, expiresAt }
}

export async function countPendingInvitationsForOrganization(
  organizationId: string
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(invitation)
    .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, 'pending')))
  return row?.count ?? 0
}

export async function findPendingInvitationByOrgEmail(params: {
  organizationId: string | null
  email: string
}) {
  const normalized = normalizeEmail(params.email)

  if (params.organizationId) {
    const [row] = await db
      .select()
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, params.organizationId),
          eq(invitation.email, normalized),
          eq(invitation.status, 'pending')
        )
      )
      .limit(1)
    return row ?? null
  }

  const [row] = await db
    .select()
    .from(invitation)
    .where(
      and(
        sql`${invitation.organizationId} IS NULL`,
        eq(invitation.email, normalized),
        eq(invitation.status, 'pending')
      )
    )
    .limit(1)
  return row ?? null
}

export async function findPendingGrantForWorkspaceEmail(params: {
  workspaceId: string
  email: string
}) {
  const normalized = normalizeEmail(params.email)
  const [row] = await db
    .select({
      invitationId: invitation.id,
      grantId: invitationWorkspaceGrant.id,
    })
    .from(invitationWorkspaceGrant)
    .innerJoin(invitation, eq(invitation.id, invitationWorkspaceGrant.invitationId))
    .where(
      and(
        eq(invitationWorkspaceGrant.workspaceId, params.workspaceId),
        eq(invitation.email, normalized),
        eq(invitation.status, 'pending')
      )
    )
    .limit(1)
  return row ?? null
}

export async function cancelPendingInvitation(invitationId: string): Promise<void> {
  await db
    .update(invitation)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(invitation.id, invitationId), eq(invitation.status, 'pending')))
}

export interface SendInvitationEmailInput {
  invitationId: string
  token: string
  kind: InvitationKind
  email: string
  inviterName: string
  organizationId: string | null
  organizationRole: 'admin' | 'member'
  grants: WorkspaceGrantInput[]
}

export interface SendInvitationEmailResult {
  success: boolean
  error?: string
}

export async function sendInvitationEmail(
  input: SendInvitationEmailInput
): Promise<SendInvitationEmailResult> {
  const inviteUrl = `${getBaseUrl()}/invite/${input.invitationId}?token=${input.token}`

  if (input.kind === 'workspace') {
    const primaryGrant = input.grants[0]
    if (!primaryGrant) {
      return { success: false, error: 'Workspace invitation is missing a workspace grant' }
    }

    const [workspaceRow] = await db
      .select({ name: workspace.name })
      .from(workspace)
      .where(eq(workspace.id, primaryGrant.workspaceId))
      .limit(1)

    const workspaceName = workspaceRow?.name || 'a workspace'
    const emailHtml = await renderWorkspaceInvitationEmail(
      input.inviterName,
      workspaceName,
      inviteUrl
    )

    const result = await sendEmail({
      to: input.email,
      subject: `You've been invited to join "${workspaceName}" on Sim`,
      html: emailHtml,
      from: getFromEmailAddress(),
      emailType: 'transactional',
    })
    if (!result.success) {
      return { success: false, error: result.message }
    }
    return { success: true }
  }

  if (!input.organizationId) {
    return { success: false, error: 'Organization invitation missing organization id' }
  }

  const [orgRow] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, input.organizationId))
    .limit(1)
  const organizationName = orgRow?.name || 'organization'

  if (input.grants.length > 0) {
    const workspaceIds = input.grants.map((grant) => grant.workspaceId)
    const workspaceRows = await db
      .select({ id: workspace.id, name: workspace.name })
      .from(workspace)
      .where(inArray(workspace.id, workspaceIds))

    const grantPayloads = input.grants.map((grant) => ({
      workspaceId: grant.workspaceId,
      workspaceName:
        workspaceRows.find((row) => row.id === grant.workspaceId)?.name || 'Unknown Workspace',
      permission: grant.permission,
    }))

    const emailHtml = await renderBatchInvitationEmail(
      input.inviterName,
      organizationName,
      input.organizationRole,
      grantPayloads,
      inviteUrl
    )

    const result = await sendEmail({
      to: input.email,
      subject: getEmailSubject('batch-invitation'),
      html: emailHtml,
      emailType: 'transactional',
    })
    if (!result.success) {
      return { success: false, error: result.message }
    }
    return { success: true }
  }

  const emailHtml = await renderInvitationEmail(input.inviterName, organizationName, inviteUrl)
  const result = await sendEmail({
    to: input.email,
    subject: getEmailSubject('invitation'),
    html: emailHtml,
    emailType: 'transactional',
  })
  if (!result.success) {
    return { success: false, error: result.message }
  }
  return { success: true }
}

export async function prepareInvitationResend(params: {
  invitationId: string
  rotateToken?: boolean
  currentToken: string
}): Promise<{ tokenForEmail: string; nextExpiresAt: Date; nextToken: string | null }> {
  const nextExpiresAt = computeInvitationExpiry()
  const nextToken = params.rotateToken ? generateId() : null
  const tokenForEmail = nextToken ?? params.currentToken
  return { tokenForEmail, nextExpiresAt, nextToken }
}

export async function persistInvitationResend(params: {
  invitationId: string
  nextToken: string | null
  nextExpiresAt: Date
}): Promise<void> {
  const [row] = await db
    .update(invitation)
    .set({
      expiresAt: params.nextExpiresAt,
      updatedAt: new Date(),
      ...(params.nextToken ? { token: params.nextToken } : {}),
    })
    .where(and(eq(invitation.id, params.invitationId), eq(invitation.status, 'pending')))
    .returning({ id: invitation.id })

  if (!row) {
    throw new Error(`Invitation ${params.invitationId} not found or no longer pending`)
  }

  logger.info('Persisted invitation resend', {
    invitationId: params.invitationId,
    rotated: !!params.nextToken,
  })
}
