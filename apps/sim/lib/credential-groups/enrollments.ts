import { db } from '@sim/db'
import {
  type CredentialGroupOptionConfig,
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  user,
  workspace,
} from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { normalizeEmail, truncate } from '@sim/utils/string'
import { and, count, desc, eq, inArray, lt, or, sql } from 'drizzle-orm'
import { renderCredentialGroupInvitationEmail } from '@/components/emails/credential-groups/render'
import { getCredentialGroupInvitationSubject } from '@/components/emails/subjects'
import { getWorkspaceOwnerSubscriptionAccess } from '@/lib/billing/core/workspace-access'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { isCredentialGroupsAvailable } from '@/lib/credential-groups/availability'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import type { CredentialGroupProvider } from '@/lib/credential-groups/providers'
import {
  CREDENTIAL_GROUP_PROVIDER_IDS,
  getCredentialGroupProviderFromProviderId,
  isCredentialGroupProvider,
} from '@/lib/credential-groups/providers'
import type {
  CredentialGroupEnrollmentConnection,
  CredentialGroupEnrollmentDetail,
  CredentialGroupEnrollmentRecord,
  InviteCredentialGroupEnrollmentsInput,
} from '@/lib/credential-groups/types'
import type { DbOrTx } from '@/lib/db/types'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getFromEmailAddress } from '@/lib/messaging/email/utils'

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DELIVERY_CONCURRENCY = 5
const MAX_ENROLLMENT_PAGE_SIZE = 100
const CONNECTION_SUMMARIES_PER_ENROLLMENT = CREDENTIAL_GROUP_PROVIDER_IDS.length * 3

type EnrollmentRow = typeof credentialGroupEnrollment.$inferSelect

export type CredentialGroupEnrollmentStatus = EnrollmentRow['status']

export interface ListCredentialGroupEnrollmentFilters {
  email?: string
  statuses?: CredentialGroupEnrollmentStatus[]
}

export interface CredentialGroupInvitationLink {
  enrollment: CredentialGroupEnrollmentRecord
  invitationLink: string
}

interface InvitationContext {
  workspaceId: string
  workspaceName: string
  groupId: string
  groupName: string
}

interface SendInvitationOptions {
  expectedEnrollmentId?: string
  revokedEnrollment: 'reactivate' | 'reject'
}

interface IssuedInvitation {
  enrollment: EnrollmentRow
  invitationLink: string
  tokenHash: string
}

export interface PublicCredentialGroupEnrollment {
  inviterName: string
  workspaceName: string
  credentialGroupName: string
  options: Array<
    Pick<CredentialGroupOptionConfig, 'id' | 'label' | 'required' | 'status'> & {
      provider: CredentialGroupProvider
      connections: Array<{
        email: string
        displayName: string | null
        avatarUrl: string | null
        status: 'connected' | 'needs_reauth' | 'revoked'
        grantedAt: string
      }>
    }
  >
  status: CredentialGroupEnrollmentRecord['status']
}

export interface CredentialGroupOAuthContext {
  enrollmentId: string
  credentialGroupId: string
  workspaceId: string
  workspaceName: string
  workspaceOwnerId: string
  email: string
  enrollmentStatus: EnrollmentRow['status']
  option: CredentialGroupOptionConfig
  options: CredentialGroupOptionConfig[]
}

export interface PublicCredentialGroupEnrollmentIdentity {
  enrollmentId: string
  credentialGroupId: string
  workspaceId: string
  email: string
  invitationTokenHash: string
}

/** Serializes OAuth grant persistence and administrative revocation for one enrollment. */
export async function lockCredentialGroupEnrollmentLifecycle(
  executor: DbOrTx,
  enrollmentId: string
): Promise<void> {
  if (!enrollmentId.trim()) throw new Error('Credential group enrollment ID is required')
  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`credential-group-enrollment:${enrollmentId}`}, 0))`
  )
}

/** Serializes invitation issuance before an enrollment row is known or locked. */
async function lockCredentialGroupInvitationTarget(
  executor: DbOrTx,
  groupId: string,
  email: string
): Promise<void> {
  if (!groupId.trim()) throw new Error('Credential group ID is required')
  if (!email.trim()) throw new Error('Credential group enrollment email is required')
  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`credential-group-invitation:${groupId}:${email}`}, 0))`
  )
}

export class CredentialGroupEnrollmentError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 502
  ) {
    super(message)
    this.name = 'CredentialGroupEnrollmentError'
  }
}

interface CredentialGroupEnrollmentCursor {
  id: string
  invitedAt: Date
}

function encodeCredentialGroupEnrollmentCursor(
  enrollment: Pick<EnrollmentRow, 'id' | 'invitedAt'>
): string {
  return Buffer.from(
    JSON.stringify({ id: enrollment.id, invitedAt: enrollment.invitedAt.toISOString() })
  ).toString('base64url')
}

function decodeCredentialGroupEnrollmentCursor(cursor: string): CredentialGroupEnrollmentCursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw new Error('Cursor payload must be an object')
    }
    const { id, invitedAt: invitedAtValue } = decoded as Record<string, unknown>
    if (
      typeof id !== 'string' ||
      !id.trim() ||
      id !== id.trim() ||
      id.length > 128 ||
      typeof invitedAtValue !== 'string'
    ) {
      throw new Error('Cursor payload is malformed')
    }
    const invitedAt = new Date(invitedAtValue)
    if (Number.isNaN(invitedAt.getTime()) || invitedAt.toISOString() !== invitedAtValue) {
      throw new Error('Cursor timestamp is invalid')
    }
    return { id, invitedAt }
  } catch {
    throw new CredentialGroupEnrollmentError('Enrollment cursor is invalid', 400)
  }
}

function hashInvitationToken(token: string): string {
  return sha256Hex(token)
}

function metadataString(metadata: object | null, key: string): string | null {
  const value = metadata ? (metadata as Record<string, unknown>)[key] : undefined
  return typeof value === 'string' && value.length > 0 ? value : null
}

async function resolvePublicEnrollmentRowByIdentity(
  identity: Pick<PublicCredentialGroupEnrollmentIdentity, 'invitationTokenHash'> & {
    enrollmentId?: string
  }
) {
  const [row] = await db
    .select({
      enrollment: credentialGroupEnrollment,
      groupId: credentialGroup.id,
      groupName: credentialGroup.name,
      groupStatus: credentialGroup.status,
      options: credentialGroup.options,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceOwnerId: workspace.ownerId,
      inviterName: user.name,
    })
    .from(credentialGroupEnrollment)
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .innerJoin(workspace, eq(workspace.id, credentialGroup.workspaceId))
    .leftJoin(user, eq(user.id, credentialGroupEnrollment.createdBy))
    .where(
      and(
        eq(credentialGroupEnrollment.invitationTokenHash, identity.invitationTokenHash),
        identity.enrollmentId ? eq(credentialGroupEnrollment.id, identity.enrollmentId) : undefined
      )
    )
    .limit(1)

  if (!row || row.groupStatus !== 'active') return null
  if (row.enrollment.status === 'revoked' || row.enrollment.status === 'delivery_failed')
    return null
  if (row.enrollment.invitationExpiresAt.getTime() <= Date.now()) return null

  const ownerBilling = await getWorkspaceOwnerSubscriptionAccess(row.workspaceId)
  if (!(await isCredentialGroupsAvailable({ workspaceId: row.workspaceId, ownerBilling })))
    return null
  return row
}

function identityForPublicEnrollmentRow(
  row: NonNullable<Awaited<ReturnType<typeof resolvePublicEnrollmentRowByIdentity>>>
): PublicCredentialGroupEnrollmentIdentity {
  return {
    enrollmentId: row.enrollment.id,
    credentialGroupId: row.groupId,
    workspaceId: row.workspaceId,
    email: row.enrollment.email,
    invitationTokenHash: row.enrollment.invitationTokenHash,
  }
}

/** Authenticates a public invitation token without exposing the bearer value downstream. */
export async function authenticatePublicCredentialGroupEnrollment(
  token: string
): Promise<PublicCredentialGroupEnrollmentIdentity | null> {
  const row = await resolvePublicEnrollmentRowByIdentity({
    invitationTokenHash: hashInvitationToken(token),
  })
  return row ? identityForPublicEnrollmentRow(row) : null
}

async function resolveAuthorizedPublicEnrollmentRow(
  identity: PublicCredentialGroupEnrollmentIdentity
) {
  const row = await resolvePublicEnrollmentRowByIdentity(identity)
  if (
    !row ||
    row.groupId !== identity.credentialGroupId ||
    row.workspaceId !== identity.workspaceId ||
    row.enrollment.email !== identity.email
  ) {
    return null
  }
  return row
}

function toCredentialGroupEnrollment(row: EnrollmentRow): CredentialGroupEnrollmentRecord {
  return {
    id: row.id,
    credentialGroupId: row.credentialGroupId,
    email: row.email,
    status: row.status,
    expiresAt: row.invitationExpiresAt.toISOString(),
    invitedAt: row.invitedAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    expired: row.invitationExpiresAt.getTime() <= Date.now(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toCredentialGroupConnectionProvider(
  providerId: string | null
): CredentialGroupEnrollmentConnection['provider'] {
  if (!providerId) throw new Error('Managed credential provider is missing')
  return getCredentialGroupProviderFromProviderId(providerId)
}

function toCredentialGroupConnectionStatus(
  status: (typeof credential.$inferSelect)['managedOauthStatus']
): CredentialGroupEnrollmentConnection['status'] {
  if (status === 'active' || status === 'needs_reauth' || status === 'revoked') return status
  throw new Error('Managed credential status is missing')
}

async function getInvitationContext(
  workspaceId: string,
  groupId: string
): Promise<InvitationContext> {
  const [row] = await db
    .select({
      workspaceId: credentialGroup.workspaceId,
      workspaceName: workspace.name,
      groupId: credentialGroup.id,
      groupName: credentialGroup.name,
      groupStatus: credentialGroup.status,
      options: credentialGroup.options,
    })
    .from(credentialGroup)
    .innerJoin(workspace, eq(workspace.id, credentialGroup.workspaceId))
    .where(and(eq(credentialGroup.id, groupId), eq(credentialGroup.workspaceId, workspaceId)))
    .limit(1)

  if (!row) throw new CredentialGroupEnrollmentError('Credential group not found', 404)
  if (row.groupStatus !== 'active') {
    throw new CredentialGroupEnrollmentError('Credential group is disabled', 409)
  }
  if (!row.options.some((option) => option.status === 'active')) {
    throw new CredentialGroupEnrollmentError('Add an account type before inviting people', 409)
  }
  return row
}

async function issueInvitation(
  context: InvitationContext,
  /**
   * Who to record as the issuer, when there is someone. Attribution only — the
   * authority to invite comes from the delegation, so an actorless run (a schedule,
   * or a webhook with no external subject) issues an unattributed invitation rather
   * than none. `created_by` is nullable and `on delete set null`, so a row with no
   * issuer is a shape the schema already carries.
   */
  userId: string | undefined,
  email: string,
  options: SendInvitationOptions
): Promise<IssuedInvitation> {
  const now = new Date()
  const token = generateId()
  const tokenHash = hashInvitationToken(token)
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS)

  const enrollment = await db.transaction(async (tx) => {
    await lockCredentialGroupInvitationTarget(tx, context.groupId, email)
    const [existing] = await tx
      .select()
      .from(credentialGroupEnrollment)
      .where(
        and(
          eq(credentialGroupEnrollment.credentialGroupId, context.groupId),
          eq(credentialGroupEnrollment.email, email)
        )
      )
      .limit(1)

    let current = existing
    if (existing) {
      await lockCredentialGroupEnrollmentLifecycle(tx, existing.id)
      const [locked] = await tx
        .select()
        .from(credentialGroupEnrollment)
        .where(
          and(
            eq(credentialGroupEnrollment.id, existing.id),
            eq(credentialGroupEnrollment.credentialGroupId, context.groupId),
            eq(credentialGroupEnrollment.email, email)
          )
        )
        .limit(1)
      current = locked
    }

    if (options.expectedEnrollmentId && current?.id !== options.expectedEnrollmentId) {
      throw new CredentialGroupEnrollmentError('Enrollment not found', 404)
    }
    if (current?.status === 'revoked' && options.revokedEnrollment === 'reject') {
      throw new CredentialGroupEnrollmentError('Revoked enrollment cannot be resent', 409)
    }

    const preservesProgress = current?.status === 'in_progress' || current?.status === 'completed'
    const nextStatus = preservesProgress ? current.status : ('invited' as const)
    const mutableValues = {
      status: nextStatus,
      invitationTokenHash: tokenHash,
      invitationExpiresAt: expiresAt,
      invitedAt: now,
      sentAt: null,
      completedAt: preservesProgress ? current.completedAt : null,
      revokedAt: null,
      lastDeliveryError: null,
      createdBy: userId ?? null,
      updatedAt: now,
    }
    const [next] = current
      ? await tx
          .update(credentialGroupEnrollment)
          .set(mutableValues)
          .where(eq(credentialGroupEnrollment.id, current.id))
          .returning()
      : await tx
          .insert(credentialGroupEnrollment)
          .values({
            id: generateId(),
            credentialGroupId: context.groupId,
            email,
            ...mutableValues,
            createdAt: now,
          })
          .returning()
    if (!next) throw new Error('Credential group enrollment write returned no row')
    return next
  })

  return {
    enrollment,
    invitationLink: `${getBaseUrl()}/credential-groups/enroll/${token}`,
    tokenHash,
  }
}

async function sendInvitation(
  context: InvitationContext,
  userId: string,
  inviterName: string,
  email: string,
  options: SendInvitationOptions
): Promise<CredentialGroupEnrollmentRecord> {
  const {
    enrollment: issued,
    invitationLink,
    tokenHash,
  } = await issueInvitation(context, userId, email, options)
  const html = await renderCredentialGroupInvitationEmail({
    recipientEmail: email,
    inviterName,
    workspaceName: context.workspaceName,
    credentialGroupName: context.groupName,
    invitationLink,
  })
  const result = await sendEmail({
    to: email,
    subject: getCredentialGroupInvitationSubject(inviterName, context.workspaceName),
    html,
    from: getFromEmailAddress(),
    emailType: 'transactional',
  })

  if (!result.success) {
    const [failed] = await db
      .update(credentialGroupEnrollment)
      .set({
        status: issued.status === 'invited' ? 'delivery_failed' : issued.status,
        lastDeliveryError: truncate(result.message, 500),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(credentialGroupEnrollment.id, issued.id),
          eq(credentialGroupEnrollment.invitationTokenHash, tokenHash),
          eq(credentialGroupEnrollment.status, issued.status)
        )
      )
      .returning({ id: credentialGroupEnrollment.id })
    if (!failed) {
      throw new CredentialGroupEnrollmentError(
        'Invitation was superseded by another enrollment action',
        409
      )
    }
    throw new CredentialGroupEnrollmentError(result.message, 502)
  }

  const [sent] = await db
    .update(credentialGroupEnrollment)
    .set({ sentAt: new Date(), lastDeliveryError: null, updatedAt: new Date() })
    .where(
      and(
        eq(credentialGroupEnrollment.id, issued.id),
        eq(credentialGroupEnrollment.invitationTokenHash, tokenHash),
        eq(credentialGroupEnrollment.status, issued.status)
      )
    )
    .returning()
  if (!sent) {
    throw new CredentialGroupEnrollmentError(
      'Invitation was superseded by another delivery request',
      409
    )
  }
  return toCredentialGroupEnrollment(sent)
}

export async function listCredentialGroupEnrollments(
  workspaceId: string,
  groupId: string,
  limit: number,
  cursor?: string,
  filters: ListCredentialGroupEnrollmentFilters = {}
): Promise<{ enrollments: CredentialGroupEnrollmentDetail[]; nextCursor: string | null }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ENROLLMENT_PAGE_SIZE) {
    throw new Error(
      `Credential group enrollment limit must be between 1 and ${MAX_ENROLLMENT_PAGE_SIZE}`
    )
  }
  const [group] = await db
    .select({ options: credentialGroup.options })
    .from(credentialGroup)
    .where(and(eq(credentialGroup.id, groupId), eq(credentialGroup.workspaceId, workspaceId)))
    .limit(1)
  if (!group) throw new CredentialGroupEnrollmentError('Credential group not found', 404)
  const activeOptionIds = group.options
    .filter((option) => option.status === 'active')
    .map((option) => option.id)

  const cursorPosition = cursor ? decodeCredentialGroupEnrollmentCursor(cursor) : undefined

  const rows = await db
    .select({ enrollment: credentialGroupEnrollment })
    .from(credentialGroupEnrollment)
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .where(
      and(
        eq(credentialGroup.id, groupId),
        eq(credentialGroup.workspaceId, workspaceId),
        filters.email ? eq(credentialGroupEnrollment.email, filters.email) : undefined,
        filters.statuses?.length
          ? inArray(credentialGroupEnrollment.status, filters.statuses)
          : undefined,
        cursorPosition
          ? or(
              lt(credentialGroupEnrollment.invitedAt, cursorPosition.invitedAt),
              and(
                eq(credentialGroupEnrollment.invitedAt, cursorPosition.invitedAt),
                lt(credentialGroupEnrollment.id, cursorPosition.id)
              )
            )
          : undefined
      )
    )
    .orderBy(desc(credentialGroupEnrollment.invitedAt), desc(credentialGroupEnrollment.id))
    .limit(limit + 1)
  const hasNextPage = rows.length > limit
  const pageRows = hasNextPage ? rows.slice(0, limit) : rows
  const enrollmentIds = pageRows.map(({ enrollment }) => enrollment.id)
  const connectionSummaryLimit = enrollmentIds.length * CONNECTION_SUMMARIES_PER_ENROLLMENT
  const connectionRows =
    enrollmentIds.length === 0 || activeOptionIds.length === 0
      ? []
      : await db
          .select({
            enrollmentId: credential.credentialGroupEnrollmentId,
            providerId: credential.providerId,
            status: credential.managedOauthStatus,
            count: count(credential.id),
          })
          .from(credential)
          .where(
            and(
              eq(credential.type, 'managed_oauth'),
              inArray(credential.credentialGroupEnrollmentId, enrollmentIds),
              inArray(credential.credentialGroupOptionId, activeOptionIds)
            )
          )
          .groupBy(
            credential.credentialGroupEnrollmentId,
            credential.providerId,
            credential.managedOauthStatus
          )
          .limit(connectionSummaryLimit + 1)
  if (connectionRows.length > connectionSummaryLimit) {
    throw new Error('Managed credential connection summaries exceed the supported provider states')
  }
  const connectionsByEnrollment = new Map<string, CredentialGroupEnrollmentConnection[]>()
  for (const connection of connectionRows) {
    if (!connection.enrollmentId) {
      throw new Error('Managed credential enrollment ID is missing')
    }
    const summary: CredentialGroupEnrollmentConnection = {
      provider: toCredentialGroupConnectionProvider(connection.providerId),
      status: toCredentialGroupConnectionStatus(connection.status),
      count: connection.count,
    }
    const current = connectionsByEnrollment.get(connection.enrollmentId)
    if (current) current.push(summary)
    else connectionsByEnrollment.set(connection.enrollmentId, [summary])
  }
  const nextCursorEnrollment = hasNextPage ? pageRows.at(-1)?.enrollment : undefined
  if (hasNextPage && !nextCursorEnrollment) {
    throw new Error('Credential group enrollment page is missing its cursor boundary')
  }
  return {
    enrollments: pageRows.map(({ enrollment }) => ({
      ...toCredentialGroupEnrollment(enrollment),
      connections: connectionsByEnrollment.get(enrollment.id) ?? [],
    })),
    nextCursor: nextCursorEnrollment
      ? encodeCredentialGroupEnrollmentCursor(nextCursorEnrollment)
      : null,
  }
}

export async function inviteCredentialGroupEnrollments(
  workspaceId: string,
  groupId: string,
  userId: string,
  inviterName: string,
  body: InviteCredentialGroupEnrollmentsInput
) {
  const context = await getInvitationContext(workspaceId, groupId)
  const emails = [...new Set(body.emails.map(normalizeEmail))]
  const results: Array<
    | { email: string; success: true; enrollment: CredentialGroupEnrollmentRecord }
    | { email: string; success: false; error: string }
  > = []

  for (let index = 0; index < emails.length; index += DELIVERY_CONCURRENCY) {
    const chunk = emails.slice(index, index + DELIVERY_CONCURRENCY)
    const chunkResults = await Promise.all(
      chunk.map(async (email) => {
        try {
          const enrollment = await sendInvitation(context, userId, inviterName, email, {
            revokedEnrollment: 'reactivate',
          })
          return { email, success: true as const, enrollment }
        } catch (error) {
          return {
            email,
            success: false as const,
            error: getErrorMessage(error, 'Failed to send invitation'),
          }
        }
      })
    )
    results.push(...chunkResults)
  }

  const sentCount = results.filter((result) => result.success).length
  return { results, sentCount, failedCount: results.length - sentCount }
}

export async function loadCredentialGroupInviterIdentity(
  userId: string
): Promise<{ name: string | null; email: string } | null> {
  const [row] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  return row ?? null
}

export async function inviteCredentialGroupEnrollment(
  workspaceId: string,
  groupId: string,
  userId: string,
  inviterName: string,
  email: string
): Promise<CredentialGroupEnrollmentRecord> {
  const context = await getInvitationContext(workspaceId, groupId)
  return sendInvitation(context, userId, inviterName, normalizeEmail(email), {
    revokedEnrollment: 'reactivate',
  })
}

export async function createCredentialGroupInvitationLink(
  workspaceId: string,
  groupId: string,
  /** See {@link issueInvitation}: the issuer is attribution, never the authority. */
  userId: string | undefined,
  email: string
): Promise<CredentialGroupInvitationLink> {
  const context = await getInvitationContext(workspaceId, groupId)
  const issued = await issueInvitation(context, userId, normalizeEmail(email), {
    revokedEnrollment: 'reactivate',
  })
  return {
    enrollment: toCredentialGroupEnrollment(issued.enrollment),
    invitationLink: issued.invitationLink,
  }
}

export async function resendCredentialGroupEnrollment(
  workspaceId: string,
  groupId: string,
  enrollmentId: string,
  userId: string,
  inviterName: string
): Promise<CredentialGroupEnrollmentRecord> {
  const context = await getInvitationContext(workspaceId, groupId)
  const [row] = await db
    .select({ enrollment: credentialGroupEnrollment })
    .from(credentialGroupEnrollment)
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .where(
      and(
        eq(credentialGroupEnrollment.id, enrollmentId),
        eq(credentialGroup.id, groupId),
        eq(credentialGroup.workspaceId, workspaceId)
      )
    )
    .limit(1)
  if (!row) throw new CredentialGroupEnrollmentError('Enrollment not found', 404)
  return sendInvitation(context, userId, inviterName, row.enrollment.email, {
    expectedEnrollmentId: enrollmentId,
    revokedEnrollment: 'reject',
  })
}

export async function deleteCredentialGroupEnrollment(
  workspaceId: string,
  groupId: string,
  enrollmentId: string
): Promise<CredentialGroupEnrollmentRecord> {
  const [existing] = await db
    .select({ email: credentialGroupEnrollment.email })
    .from(credentialGroupEnrollment)
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .where(
      and(
        eq(credentialGroupEnrollment.id, enrollmentId),
        eq(credentialGroup.id, groupId),
        eq(credentialGroup.workspaceId, workspaceId)
      )
    )
    .limit(1)
  if (!existing) throw new CredentialGroupEnrollmentError('Enrollment not found', 404)

  return db.transaction(async (tx) => {
    await lockCredentialGroupInvitationTarget(tx, groupId, existing.email)
    await lockCredentialGroupEnrollmentLifecycle(tx, enrollmentId)
    const [deleted] = await tx
      .delete(credentialGroupEnrollment)
      .where(
        and(
          eq(credentialGroupEnrollment.id, enrollmentId),
          eq(credentialGroupEnrollment.credentialGroupId, groupId)
        )
      )
      .returning()
    if (!deleted) throw new CredentialGroupEnrollmentError('Enrollment not found', 404)
    return toCredentialGroupEnrollment(deleted)
  })
}

export async function getPublicCredentialGroupEnrollment(
  token: string
): Promise<PublicCredentialGroupEnrollment | null> {
  const row = await resolvePublicEnrollmentRowByIdentity({
    invitationTokenHash: hashInvitationToken(token),
  })
  return row ? buildPublicCredentialGroupEnrollment(row) : null
}

export async function getAuthorizedPublicCredentialGroupEnrollment(
  identity: PublicCredentialGroupEnrollmentIdentity
): Promise<PublicCredentialGroupEnrollment | null> {
  const row = await resolveAuthorizedPublicEnrollmentRow(identity)
  if (!row) return null

  return buildPublicCredentialGroupEnrollment(row)
}

async function buildPublicCredentialGroupEnrollment(
  row: NonNullable<Awaited<ReturnType<typeof resolvePublicEnrollmentRowByIdentity>>>
): Promise<PublicCredentialGroupEnrollment> {
  const connectionRows = await db
    .select({
      optionId: credential.credentialGroupOptionId,
      status: credential.managedOauthStatus,
      scopeVersion: credential.managedOauthScopeVersion,
      authorizationAppId: credential.authorizationAppId,
      grantedScopes: credential.grantedScopes,
      displayName: credential.displayName,
      metadata: credential.providerMetadata,
      grantedAt: credential.grantedAt,
    })
    .from(credential)
    .where(
      and(
        eq(credential.type, 'managed_oauth'),
        eq(credential.credentialGroupEnrollmentId, row.enrollment.id)
      )
    )

  return {
    inviterName: row.inviterName ?? 'A workspace admin',
    workspaceName: row.workspaceName,
    credentialGroupName: row.groupName,
    options: await Promise.all(
      row.options.map(async (option) => {
        if (!isCredentialGroupProvider(option.provider)) {
          throw new Error(`Unsupported Credential Group provider: ${option.provider}`)
        }
        const adapter = getCredentialGroupProviderAdapter(option.provider)
        const policy = await adapter.getPolicy(option, {
          workspaceId: row.workspaceId,
          credentialGroupId: row.groupId,
        })
        return {
          id: option.id,
          provider: option.provider,
          label: option.label,
          required: option.required,
          status: option.status,
          connections: connectionRows
            .filter((connection) => connection.optionId === option.id && connection.grantedAt)
            .map((connection) => {
              const email = metadataString(connection.metadata, 'email') ?? connection.displayName
              const status =
                connection.status === 'revoked'
                  ? ('revoked' as const)
                  : connection.status !== 'active' ||
                      connection.authorizationAppId !== policy.authorizationAppId ||
                      connection.scopeVersion !== policy.scopeVersion ||
                      !adapter.hasRequiredScopes(
                        connection.grantedScopes ?? [],
                        policy.requiredScopes
                      )
                    ? ('needs_reauth' as const)
                    : ('connected' as const)
              return {
                email,
                displayName:
                  metadataString(connection.metadata, 'displayName') ??
                  metadataString(connection.metadata, 'name'),
                avatarUrl:
                  metadataString(connection.metadata, 'avatarUrl') ??
                  metadataString(connection.metadata, 'picture'),
                status,
                grantedAt: connection.grantedAt!.toISOString(),
              }
            }),
        }
      })
    ),
    status: row.enrollment.status,
  }
}

/** Finalizes an enrollment after the recipient finishes their optional account selections. */
export async function completeCredentialGroupEnrollment(token: string): Promise<true | null> {
  const row = await resolvePublicEnrollmentRowByIdentity({
    invitationTokenHash: hashInvitationToken(token),
  })
  if (!row) return null
  return completeResolvedCredentialGroupEnrollment(row, identityForPublicEnrollmentRow(row))
}

export async function completeAuthorizedCredentialGroupEnrollment(
  identity: PublicCredentialGroupEnrollmentIdentity
): Promise<true | null> {
  const row = await resolveAuthorizedPublicEnrollmentRow(identity)
  if (!row) return null
  return completeResolvedCredentialGroupEnrollment(row, identity)
}

async function completeResolvedCredentialGroupEnrollment(
  row: NonNullable<Awaited<ReturnType<typeof resolvePublicEnrollmentRowByIdentity>>>,
  identity: PublicCredentialGroupEnrollmentIdentity
): Promise<true | null> {
  return db.transaction(async (tx) => {
    await lockCredentialGroupEnrollmentLifecycle(tx, row.enrollment.id)
    const now = new Date()
    const [current] = await tx
      .select({
        status: credentialGroupEnrollment.status,
        invitationTokenHash: credentialGroupEnrollment.invitationTokenHash,
        invitationExpiresAt: credentialGroupEnrollment.invitationExpiresAt,
      })
      .from(credentialGroupEnrollment)
      .where(eq(credentialGroupEnrollment.id, row.enrollment.id))
      .limit(1)
    if (
      !current ||
      current.status === 'revoked' ||
      current.status === 'delivery_failed' ||
      current.invitationTokenHash !== identity.invitationTokenHash ||
      current.invitationExpiresAt.getTime() <= now.getTime()
    ) {
      return null
    }

    const [group] = await tx
      .select({
        status: credentialGroup.status,
      })
      .from(credentialGroup)
      .where(
        and(
          eq(credentialGroup.id, identity.credentialGroupId),
          eq(credentialGroup.workspaceId, identity.workspaceId)
        )
      )
      .limit(1)
      .for('update')
    if (!group || group.status !== 'active') return null

    const [completed] = await tx
      .update(credentialGroupEnrollment)
      .set({ status: 'completed', completedAt: now, updatedAt: now })
      .where(
        and(
          eq(credentialGroupEnrollment.id, row.enrollment.id),
          inArray(credentialGroupEnrollment.status, ['invited', 'in_progress', 'completed'])
        )
      )
      .returning({ id: credentialGroupEnrollment.id })
    if (!completed) throw new Error('Credential group enrollment completion returned no row')
    return true
  })
}

/** Resolves the private, server-only context bound to a public enrollment link and option. */
export async function getCredentialGroupOAuthContext(
  token: string,
  optionId: string
): Promise<CredentialGroupOAuthContext | null> {
  const row = await resolvePublicEnrollmentRowByIdentity({
    invitationTokenHash: hashInvitationToken(token),
  })
  if (!row) return null
  const option = row.options.find((candidate) => candidate.id === optionId)
  if (!option || option.status !== 'active') return null
  return credentialGroupOAuthContextFromRow(row, option)
}

export async function getAuthorizedCredentialGroupOAuthContext(
  identity: PublicCredentialGroupEnrollmentIdentity,
  optionId: string
): Promise<CredentialGroupOAuthContext | null> {
  const row = await resolveAuthorizedPublicEnrollmentRow(identity)
  if (!row) return null
  const option = row.options.find((candidate) => candidate.id === optionId)
  if (!option || option.status !== 'active') return null
  return credentialGroupOAuthContextFromRow(row, option)
}

function credentialGroupOAuthContextFromRow(
  row: NonNullable<Awaited<ReturnType<typeof resolvePublicEnrollmentRowByIdentity>>>,
  option: CredentialGroupOptionConfig
): CredentialGroupOAuthContext {
  return {
    enrollmentId: row.enrollment.id,
    credentialGroupId: row.groupId,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    workspaceOwnerId: row.workspaceOwnerId,
    email: row.enrollment.email,
    enrollmentStatus: row.enrollment.status,
    option,
    options: row.options,
  }
}
