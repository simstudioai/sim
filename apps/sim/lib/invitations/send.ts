import { db } from '@sim/db'
import {
  type InvitationKind,
  type InvitationMembershipIntent,
  invitation,
  invitationWorkspaceGrant,
  organization,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { normalizeEmail } from '@sim/utils/string'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import {
  getEmailSubject,
  renderBatchInvitationEmail,
  renderInvitationEmail,
  renderWorkspaceAddedEmail,
  renderWorkspaceInvitationEmail,
} from '@/components/emails'
import { getBaseUrl } from '@/lib/core/utils/urls'
import type { DbOrTx } from '@/lib/db/types'
import { computeInvitationExpiry, lockInvitationForMutation } from '@/lib/invitations/core'
import { acquireInvitationMutationLocks } from '@/lib/invitations/locks'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getFromEmailAddress } from '@/lib/messaging/email/utils'
import { getBrandConfig } from '@/ee/whitelabeling'

const logger = createLogger('InvitationSend')

interface WorkspaceGrantInput {
  workspaceId: string
  permission: 'admin' | 'write' | 'read'
}

export interface CreatePendingInvitationInput {
  kind: InvitationKind
  email: string
  inviterId: string
  organizationId: string | null
  membershipIntent?: InvitationMembershipIntent
  role: 'admin' | 'member'
  grants: WorkspaceGrantInput[]
  expiresAt?: Date
  /**
   * Runs after the canonical invitation/workspace advisory locks are held and
   * the live organization scope has been resolved, but before any invitation
   * write. Callers use this DB-only hook to acquire organization/user locks
   * and re-authorize stale preflight decisions.
   */
  validateLockedContext?: (context: {
    tx: DbOrTx
    organizationId: string | null
    workspaceIds: string[]
  }) => Promise<void>
}

export interface CreatePendingInvitationResult {
  invitationId: string
  token: string
  expiresAt: Date
  /**
   * False when the grants were merged into an invitation that was already
   * pending for this (email, organization). Callers compensating for a failed
   * send must revert only the added grants in that case — cancelling would
   * destroy an unrelated, still-valid invitation.
   */
  created: boolean
  /** Workspaces this call added; empty when every grant was already present. */
  addedWorkspaceIds: string[]
  /** Every workspace the invitation now grants, oldest grant first. */
  grants: WorkspaceGrantInput[]
  /**
   * Optimistic revision for failed-send compensation. A workspace move,
   * acceptance, PATCH, or other later mutation changes this timestamp, causing
   * compensation to skip rather than undo newer state.
   */
  mutationUpdatedAt: Date
  /** Scope paired with the revision so a migrated pending invite is never undone. */
  mutationOrganizationId: string | null
}

/**
 * Partial unique index on `invitation (email, organization_id) WHERE status =
 * 'pending' AND organization_id IS NOT NULL` — one pending invitation per
 * person per organization, which is what makes coalescing mandatory rather
 * than optional.
 */
export const PENDING_INVITATION_UNIQUE_INDEX = 'invitation_pending_email_org_unique'

/**
 * Raised when the granted workspaces changed organization between the
 * pre-lock lookup and the lock itself, so the invitation that would be merged
 * into was never covered by the acquired locks. Retrying re-resolves the
 * organization and locks the right row.
 */
class InvitationScopeChangedError extends Error {
  constructor() {
    super('Invitation organization scope changed while acquiring locks')
    this.name = 'InvitationScopeChangedError'
  }
}

function isPendingInvitationConflict(error: unknown): boolean {
  return (
    error instanceof InvitationScopeChangedError ||
    (getPostgresErrorCode(error) === '23505' &&
      getPostgresConstraintName(error) === PENDING_INVITATION_UNIQUE_INDEX)
  )
}

/**
 * The organization an invitation is stamped with. Workspace invitations derive
 * it from the granted workspaces' live organization so a workspace that moved
 * since the inviter loaded the page is stamped with where it actually lives.
 */
async function resolveInvitationOrganizationId(
  executor: DbOrTx,
  input: CreatePendingInvitationInput,
  workspaceIds: string[]
): Promise<string | null> {
  if (input.kind !== 'workspace' || workspaceIds.length === 0) return input.organizationId

  const currentScopes = await executor
    .select({ organizationId: workspace.organizationId })
    .from(workspace)
    .where(inArray(workspace.id, workspaceIds))
  const uniqueScopes = [...new Set(currentScopes.map((row) => row.organizationId))]
  return uniqueScopes.length === 1 ? uniqueScopes[0] : input.organizationId
}

export async function findPendingOrganizationInvitation(
  executor: DbOrTx,
  organizationId: string,
  email: string
) {
  const [row] = await executor
    .select({
      id: invitation.id,
      token: invitation.token,
      expiresAt: invitation.expiresAt,
      role: invitation.role,
      membershipIntent: invitation.membershipIntent,
      updatedAt: invitation.updatedAt,
      organizationId: invitation.organizationId,
    })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, organizationId),
        eq(invitation.email, email),
        eq(invitation.status, 'pending')
      )
    )
    .limit(1)
  return row ?? null
}

function describeInvitationStanding(
  membershipIntent: InvitationMembershipIntent,
  role: string
): string {
  if (membershipIntent === 'external') return 'an external collaborator'
  return isOrgAdminRole(role) ? 'an organization admin' : 'an organization member'
}

/**
 * Thrown when new workspaces would merge into a pending invitation that grants
 * a different standing. Adding workspaces must never quietly re-decide whether
 * the invitee takes a seat or becomes an admin, and neither silent outcome is
 * right — the old choice ignores what the inviter just asked for, the new one
 * rewrites an invitation somebody else may have sent. The inviter resolves it.
 */
export class ConflictingPendingInvitationError extends Error {
  constructor(params: {
    email: string
    existing: { membershipIntent: InvitationMembershipIntent; role: string }
    requested: { membershipIntent: InvitationMembershipIntent; role: string }
  }) {
    super(
      `${params.email} already has a pending invitation as ${describeInvitationStanding(
        params.existing.membershipIntent,
        params.existing.role
      )}. Cancel it before inviting them as ${describeInvitationStanding(
        params.requested.membershipIntent,
        params.requested.role
      )}.`
    )
    this.name = 'ConflictingPendingInvitationError'
  }
}

/**
 * Workspace and external invitations must grant a workspace. An internal
 * organization invitation can instead land directly in organization Home.
 */
export class GrantlessInvitationError extends Error {
  constructor() {
    super('Workspace and external invitations must include at least one workspace.')
    this.name = 'GrantlessInvitationError'
  }
}

/**
 * Creates a pending invitation, or extends the one already pending for this
 * (email, organization) with the workspaces it does not cover yet.
 *
 * Coalescing is required, not a convenience: a person can hold at most one
 * pending invitation per organization, so inviting them to a second workspace
 * has to become another grant on the same invitation. It also gives the
 * invitee one link that grants everything they were invited to, instead of a
 * queue of invitations to accept one at a time.
 *
 * Invitations with no organization (personal-workspace invites) are never
 * coalesced — they are scoped to their inviter, and acceptance converts *that*
 * inviter's plan, so two inviters' invites must stay independent.
 */
export async function createPendingInvitation(
  input: CreatePendingInvitationInput
): Promise<CreatePendingInvitationResult> {
  if (
    input.grants.length === 0 &&
    (input.kind !== 'organization' ||
      !input.organizationId ||
      input.membershipIntent === 'external')
  ) {
    throw new GrantlessInvitationError()
  }

  try {
    return await createOrExtendPendingInvitation(input)
  } catch (error) {
    if (!isPendingInvitationConflict(error)) throw error
    /**
     * A concurrent invite created the pending row, or moved a granted
     * workspace, between the pre-lock lookup and the insert. The retry sees
     * the committed row and merges into it.
     */
    return createOrExtendPendingInvitation(input)
  }
}

async function createOrExtendPendingInvitation(
  input: CreatePendingInvitationInput
): Promise<CreatePendingInvitationResult> {
  const email = normalizeEmail(input.email)
  const workspaceIds = input.grants.map((grant) => grant.workspaceId)

  /**
   * Resolved before the transaction so the invitation being merged into can
   * join the same sorted lock acquisition. Advisory locks must be taken in one
   * call — invitation keys sort before workspace keys, matching the order
   * acceptance takes them in, so the two paths cannot deadlock.
   */
  const scopeOrganizationId = await resolveInvitationOrganizationId(db, input, workspaceIds)
  const knownPendingId = scopeOrganizationId
    ? (await findPendingOrganizationInvitation(db, scopeOrganizationId, email))?.id
    : undefined

  const newInvitationId = generateId()
  const token = generateId()
  const expiresAt = input.expiresAt ?? computeInvitationExpiry()
  const now = new Date()

  return db.transaction(async (tx) => {
    await acquireInvitationMutationLocks(tx, {
      invitationIds: knownPendingId ? [knownPendingId, newInvitationId] : [newInvitationId],
      workspaceIds,
    })

    const organizationId = await resolveInvitationOrganizationId(tx, input, workspaceIds)
    await input.validateLockedContext?.({ tx, organizationId, workspaceIds })
    const existing = organizationId
      ? await findPendingOrganizationInvitation(tx, organizationId, email)
      : null

    if (existing && existing.id !== knownPendingId) {
      throw new InvitationScopeChangedError()
    }

    if (existing) {
      return extendPendingInvitation(tx, { existing, input, expiresAt, now })
    }

    await tx.insert(invitation).values({
      id: newInvitationId,
      kind: input.kind,
      email,
      inviterId: input.inviterId,
      organizationId,
      membershipIntent: input.membershipIntent ?? 'internal',
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
        invitationId: newInvitationId,
        workspaceId: grant.workspaceId,
        permission: grant.permission,
        createdAt: now,
        updatedAt: now,
      })
    }

    return {
      invitationId: newInvitationId,
      token,
      expiresAt,
      created: true,
      addedWorkspaceIds: workspaceIds,
      grants: input.grants,
      mutationUpdatedAt: now,
      mutationOrganizationId: organizationId,
    }
  })
}

/**
 * Adds the grants an already-pending invitation is missing. Its kind, role, and
 * membership intent are left alone — they decide what acceptance does to the
 * invitee's organization membership, and adding a workspace is not consent to
 * change that — so a request for a different standing is rejected above rather
 * than resolved silently. Permissions on grants that already exist are likewise
 * untouched, so an invite can never downgrade access already promised.
 */
async function extendPendingInvitation(
  tx: DbOrTx,
  params: {
    existing: {
      id: string
      token: string
      expiresAt: Date
      role: string
      membershipIntent: InvitationMembershipIntent
      updatedAt: Date
      organizationId: string | null
    }
    input: CreatePendingInvitationInput
    expiresAt: Date
    now: Date
  }
): Promise<CreatePendingInvitationResult> {
  const { existing, input, expiresAt, now } = params

  const requestedIntent = input.membershipIntent ?? 'internal'
  if (
    existing.membershipIntent !== requestedIntent ||
    isOrgAdminRole(existing.role) !== isOrgAdminRole(input.role)
  ) {
    throw new ConflictingPendingInvitationError({
      email: normalizeEmail(input.email),
      existing: { membershipIntent: existing.membershipIntent, role: existing.role },
      requested: { membershipIntent: requestedIntent, role: input.role },
    })
  }

  const existingGrants = await tx
    .select({
      workspaceId: invitationWorkspaceGrant.workspaceId,
      permission: invitationWorkspaceGrant.permission,
    })
    .from(invitationWorkspaceGrant)
    .where(eq(invitationWorkspaceGrant.invitationId, existing.id))
    .orderBy(asc(invitationWorkspaceGrant.createdAt), asc(invitationWorkspaceGrant.id))

  const grantedWorkspaceIds = new Set(existingGrants.map((grant) => grant.workspaceId))
  const addedGrants = input.grants.filter((grant) => !grantedWorkspaceIds.has(grant.workspaceId))

  for (const grant of addedGrants) {
    await tx.insert(invitationWorkspaceGrant).values({
      id: generateId(),
      invitationId: existing.id,
      workspaceId: grant.workspaceId,
      permission: grant.permission,
      createdAt: now,
      updatedAt: now,
    })
  }

  /**
   * Extending expiry keeps a late-added workspace from riding an almost-dead
   * link. It only ever moves the deadline out, so it needs no compensation
   * when the send fails.
   */
  const nextExpiresAt = existing.expiresAt > expiresAt ? existing.expiresAt : expiresAt
  if (addedGrants.length > 0) {
    await tx
      .update(invitation)
      .set({ expiresAt: nextExpiresAt, updatedAt: now })
      .where(eq(invitation.id, existing.id))
  }

  return {
    invitationId: existing.id,
    token: existing.token,
    expiresAt: nextExpiresAt,
    created: false,
    addedWorkspaceIds: addedGrants.map((grant) => grant.workspaceId),
    grants: [...existingGrants, ...addedGrants],
    mutationUpdatedAt: addedGrants.length > 0 ? now : existing.updatedAt,
    mutationOrganizationId: existing.organizationId,
  }
}

/**
 * Undoes the grants a failed send added to a pre-existing invitation. The
 * invitation itself survives — it was valid before this call and the
 * workspaces it already covered are unaffected.
 */
export async function revertPendingInvitationGrants(params: {
  invitationId: string
  workspaceIds: string[]
  expectedUpdatedAt: Date
  expectedOrganizationId: string | null
}): Promise<boolean> {
  if (params.workspaceIds.length === 0) return false

  return db.transaction(async (tx) => {
    const locked = await lockInvitationForMutation(tx, params.invitationId)
    if (
      !locked ||
      locked.status !== 'pending' ||
      locked.organizationId !== params.expectedOrganizationId ||
      locked.updatedAt.getTime() !== params.expectedUpdatedAt.getTime()
    ) {
      return false
    }

    const now = new Date()
    const claimed = await tx
      .update(invitation)
      .set({ updatedAt: now })
      .where(
        and(
          eq(invitation.id, params.invitationId),
          eq(invitation.status, 'pending'),
          eq(invitation.updatedAt, params.expectedUpdatedAt),
          params.expectedOrganizationId
            ? eq(invitation.organizationId, params.expectedOrganizationId)
            : sql`${invitation.organizationId} IS NULL`
        )
      )
      .returning({ id: invitation.id })
    if (claimed.length === 0) return false

    await tx
      .delete(invitationWorkspaceGrant)
      .where(
        and(
          eq(invitationWorkspaceGrant.invitationId, params.invitationId),
          inArray(invitationWorkspaceGrant.workspaceId, params.workspaceIds)
        )
      )
    return true
  })
}

/**
 * Workspaces this email already holds a pending grant for, across every
 * pending invitation. Callers use it to drop workspaces from a new invite
 * rather than rejecting the whole thing.
 */
export async function findPendingGrantWorkspaceIds(params: {
  workspaceIds: string[]
  email: string
}): Promise<Set<string>> {
  if (params.workspaceIds.length === 0) return new Set()

  const rows = await db
    .select({ workspaceId: invitationWorkspaceGrant.workspaceId })
    .from(invitationWorkspaceGrant)
    .innerJoin(invitation, eq(invitation.id, invitationWorkspaceGrant.invitationId))
    .where(
      and(
        inArray(invitationWorkspaceGrant.workspaceId, params.workspaceIds),
        eq(invitation.email, normalizeEmail(params.email)),
        eq(invitation.status, 'pending')
      )
    )
  return new Set(rows.map((row) => row.workspaceId))
}

export async function cancelPendingInvitation(
  invitationId: string,
  guard?: {
    expectedUpdatedAt: Date
    expectedOrganizationId: string | null
  }
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const locked = await lockInvitationForMutation(tx, invitationId)
    if (!locked || locked.status !== 'pending') return false
    if (
      guard &&
      (locked.organizationId !== guard.expectedOrganizationId ||
        locked.updatedAt.getTime() !== guard.expectedUpdatedAt.getTime())
    ) {
      return false
    }

    const cancelled = await tx
      .update(invitation)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(invitation.id, invitationId),
          eq(invitation.status, 'pending'),
          ...(guard
            ? [
                eq(invitation.updatedAt, guard.expectedUpdatedAt),
                guard.expectedOrganizationId
                  ? eq(invitation.organizationId, guard.expectedOrganizationId)
                  : sql`${invitation.organizationId} IS NULL`,
              ]
            : [])
        )
      )
      .returning({ id: invitation.id })
    return cancelled.length > 0
  })
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
    if (input.grants.length === 0) {
      return { success: false, error: 'Workspace invitation is missing a workspace grant' }
    }

    const grantWorkspaceIds = input.grants.map((grant) => grant.workspaceId)
    const workspaceRows = await db
      .select({ id: workspace.id, name: workspace.name })
      .from(workspace)
      .where(inArray(workspace.id, grantWorkspaceIds))
    const workspaceNames = grantWorkspaceIds.map(
      (id) => workspaceRows.find((row) => row.id === id)?.name || 'a workspace'
    )

    const emailHtml = await renderWorkspaceInvitationEmail(
      input.inviterName,
      workspaceNames,
      inviteUrl
    )

    const brandName = getBrandConfig().name
    const subject =
      workspaceNames.length === 1
        ? `You've been invited to join "${workspaceNames[0]}" on ${brandName}`
        : `You've been invited to join ${workspaceNames.length} workspaces on ${brandName}`

    const result = await sendEmail({
      to: input.email,
      subject,
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

export interface SendWorkspaceAddedEmailInput {
  email: string
  inviterName: string
  workspaceId: string
  workspaceName: string
}

/**
 * Lightweight notification sent when an existing organization member is added
 * directly to a workspace. Unlike an invitation email, this links straight to
 * the workspace and has no acceptance step.
 */
export async function sendWorkspaceAddedEmail(
  input: SendWorkspaceAddedEmailInput
): Promise<SendInvitationEmailResult> {
  const workspaceLink = `${getBaseUrl()}/workspace/${input.workspaceId}`
  const emailHtml = await renderWorkspaceAddedEmail(
    input.inviterName,
    input.workspaceName,
    workspaceLink
  )

  const result = await sendEmail({
    to: input.email,
    subject: getEmailSubject('workspace-added'),
    html: emailHtml,
    from: getFromEmailAddress(),
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
