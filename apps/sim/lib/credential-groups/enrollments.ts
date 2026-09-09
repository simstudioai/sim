import { db } from '@sim/db'
import {
  type CredentialGroupOptionConfig,
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  mcpServers,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { normalizeEmail, truncate } from '@sim/utils/string'
import { and, asc, count, desc, eq, inArray, isNull, lt, or, type SQL, sql } from 'drizzle-orm'
import { renderCredentialGroupInvitationEmail } from '@/components/emails/credential-groups/render'
import { getCredentialGroupInvitationSubject } from '@/components/emails/subjects'
import { searchFilter } from '@/lib/api/list-query'
import {
  type ResourceScope,
  resourceScopeFields,
  resourceScopeFromOwner,
  sameResourceScope,
} from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { getBaseUrl } from '@/lib/core/utils/urls'
import type { ManagedMcpConnectorId } from '@/lib/credential-groups/managed-mcp-connectors'
import { getManagedMcpConnector } from '@/lib/credential-groups/managed-mcp-connectors'
import { requireOrganizationAccountsSetup } from '@/lib/credential-groups/organization-setup'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import type { CredentialGroupProvider } from '@/lib/credential-groups/providers'
import {
  CREDENTIAL_GROUP_PROVIDER_IDS,
  getCredentialGroupProviderFromProviderId,
  isCredentialGroupProvider,
} from '@/lib/credential-groups/providers'
import { credentialGroupScope } from '@/lib/credential-groups/scope'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'
import type {
  CredentialGroupEnrollmentConnection,
  CredentialGroupEnrollmentDetail,
  CredentialGroupEnrollmentMcpConnection,
  CredentialGroupEnrollmentRecord,
  InviteCredentialGroupEnrollmentsInput,
} from '@/lib/credential-groups/types'
import type { DbOrTx } from '@/lib/db/types'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getFromEmailAddress } from '@/lib/messaging/email/utils'

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DELIVERY_CONCURRENCY = 5
const MAX_ENROLLMENT_PAGE_SIZE = 100
const CONNECTION_SUMMARIES_PER_ENROLLMENT = (CREDENTIAL_GROUP_PROVIDER_IDS.length + 1) * 3

type EnrollmentRow = typeof credentialGroupEnrollment.$inferSelect

export type CredentialGroupEnrollmentStatus = EnrollmentRow['status']

export interface ListCredentialGroupEnrollmentFilters {
  optionId?: string
  email?: string
  search?: string
  statuses?: CredentialGroupEnrollmentStatus[]
}

export interface CredentialGroupInvitationLink {
  enrollment: CredentialGroupEnrollmentRecord
  invitationLink: string
}

interface InvitationContext {
  workspaceId?: string | null
  organizationId?: string | null
  workspaceName: string
  groupId: string
  groupName: string
}

/** What issuing an invitation does to an enrollment an admin revoked. */
export type RevokedEnrollmentPolicy = 'reactivate' | 'reject'

interface SendInvitationOptions {
  expectedEnrollmentId?: string
  revokedEnrollment: RevokedEnrollmentPolicy
  searchConnection?: { optionId: string; providerName: string }
}

interface IssuedInvitation {
  enrollment: EnrollmentRow
  invitationLink: string
  tokenHash: string
}

export interface PublicCredentialGroupEnrollment {
  /** Null when the invitation was issued by a workflow or a since-deleted user. */
  inviterName: string | null
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
  mcpServers: Array<{
    id: string
    name: string
    description: string | null
    managedConnectorId: ManagedMcpConnectorId
    connection: {
      id: string
      status: 'connected' | 'needs_reauth' | 'revoked'
      grantedAt: string
    } | null
  }>
  status: CredentialGroupEnrollmentRecord['status']
}

export interface CredentialGroupOAuthContext {
  enrollmentId: string
  credentialGroupId: string
  credentialGroupName: string
  workspaceId?: string
  organizationId?: string
  workspaceName: string
  workspaceOwnerId: string | null
  credentialOwnerId?: string | null
  email: string
  enrollmentStatus: EnrollmentRow['status']
  option: CredentialGroupOptionConfig
  options: CredentialGroupOptionConfig[]
}

export interface CredentialGroupMcpOAuthContext {
  credentialGroupName: string
  userId: string
  enrollmentId: string
  credentialGroupId: string
  workspaceId?: string
  organizationId?: string
  email: string
  enrollmentStatus: EnrollmentRow['status']
  server: {
    connectorId: ManagedMcpConnectorId
    id: string
    name: string
    url: string
    oauthConfigVersion: number
  }
}

export interface PublicCredentialGroupEnrollmentIdentity {
  userId?: string
  enrollmentId: string
  credentialGroupId: string
  workspaceId?: string
  organizationId?: string
  email: string
  invitationTokenHash: string
}

export interface CredentialGroupEnrollmentCompletion {
  completed: true
  transitioned: boolean
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

async function loadLiveEnrollmentRow(scope: SQL | undefined) {
  if (!scope) throw new Error('Enrollment lookup requires a scope')
  const [row] = await db
    .select({
      enrollment: credentialGroupEnrollment,
      groupId: credentialGroup.id,
      groupName: credentialGroup.name,
      groupStatus: credentialGroup.status,
      options: credentialGroup.options,
      workspaceId: credentialGroup.workspaceId,
      organizationId: credentialGroup.organizationId,
      organizationName: organization.name,
      workspaceName: workspace.name,
      workspaceOwnerId: workspace.ownerId,
      inviterName: user.name,
    })
    .from(credentialGroupEnrollment)
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .leftJoin(workspace, eq(workspace.id, credentialGroup.workspaceId))
    .leftJoin(organization, eq(organization.id, credentialGroup.organizationId))
    .leftJoin(user, eq(user.id, credentialGroupEnrollment.createdBy))
    .where(scope)
    .limit(1)

  if (!row || row.groupStatus !== 'active') return null
  if (
    row.enrollment.status === 'revoked' ||
    row.enrollment.status === 'delivery_failed' ||
    row.enrollment.revokedAt
  )
    return null

  const ownerScope = resourceScopeFromOwner(row)
  if (!(await isScopedCredentialGroupsAvailable(ownerScope))) return null
  return {
    ...row,
    credentialOwnerId: row.enrollment.userId,
    workspaceName: row.organizationName ?? row.workspaceName ?? '',
  }
}

async function resolvePublicEnrollmentRowByIdentity(
  identity: Pick<PublicCredentialGroupEnrollmentIdentity, 'invitationTokenHash'> & {
    enrollmentId?: string
  }
) {
  const row = await loadLiveEnrollmentRow(
    and(
      eq(credentialGroupEnrollment.invitationTokenHash, identity.invitationTokenHash),
      identity.enrollmentId ? eq(credentialGroupEnrollment.id, identity.enrollmentId) : undefined
    )
  )
  return row && row.enrollment.invitationExpiresAt.getTime() > Date.now() ? row : null
}

function identityForPublicEnrollmentRow(
  row: NonNullable<Awaited<ReturnType<typeof resolvePublicEnrollmentRowByIdentity>>>
): PublicCredentialGroupEnrollmentIdentity {
  return {
    enrollmentId: row.enrollment.id,
    credentialGroupId: row.groupId,
    ...resourceScopeFields(resourceScopeFromOwner(row)),
    email: row.enrollment.email,
    invitationTokenHash: row.enrollment.invitationTokenHash,
    ...(row.enrollment.userId ? { userId: row.enrollment.userId } : {}),
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
    !sameResourceScope(resourceScopeFromOwner(row), resourceScopeFromOwner(identity)) ||
    row.enrollment.email !== identity.email ||
    (identity.userId !== undefined && row.enrollment.userId !== identity.userId)
  ) {
    return null
  }
  return row
}

/** Binds invitation authority to a verified signed-in user once, under the enrollment lifecycle lock. */
export async function bindCredentialGroupEnrollmentUser(
  identity: PublicCredentialGroupEnrollmentIdentity,
  userId: string
): Promise<void> {
  if (!userId.trim())
    throw new CredentialGroupEnrollmentError('Sign in to connect your accounts', 400)
  if (identity.organizationId)
    await requireOrganizationAccountsSetup(identity.organizationId, identity.credentialGroupId)
  await db.transaction(async (tx) => {
    await lockCredentialGroupEnrollmentLifecycle(tx, identity.enrollmentId)
    const [row] = await tx
      .select({
        enrollment: credentialGroupEnrollment,
        email: user.email,
        verified: user.emailVerified,
      })
      .from(credentialGroupEnrollment)
      .innerJoin(
        credentialGroup,
        eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId)
      )
      .innerJoin(user, eq(user.id, userId))
      .where(
        and(
          eq(credentialGroupEnrollment.id, identity.enrollmentId),
          eq(credentialGroupEnrollment.credentialGroupId, identity.credentialGroupId),
          eq(credentialGroupEnrollment.invitationTokenHash, identity.invitationTokenHash),
          eq(credentialGroupEnrollment.email, identity.email),
          resourceScopeCondition(credentialGroup, resourceScopeFromOwner(identity)),
          eq(credentialGroup.status, 'active')
        )
      )
      .limit(1)
      .for('update', { of: credentialGroupEnrollment })
    if (
      !row ||
      row.enrollment.invitationExpiresAt.getTime() <= Date.now() ||
      row.enrollment.revokedAt ||
      ['revoked', 'delivery_failed'].includes(row.enrollment.status)
    ) {
      throw new CredentialGroupEnrollmentError('Invitation is invalid or expired', 404)
    }
    if (
      !row.verified ||
      (row.enrollment.userId
        ? row.enrollment.userId !== userId
        : normalizeEmail(row.email) !== identity.email)
    ) {
      throw new CredentialGroupEnrollmentError(
        'Sign in with the verified email address this invitation was sent to',
        400
      )
    }
    if (!row.enrollment.userId) {
      await tx
        .update(credentialGroupEnrollment)
        .set({ userId, updatedAt: new Date() })
        .where(
          and(
            eq(credentialGroupEnrollment.id, identity.enrollmentId),
            isNull(credentialGroupEnrollment.userId)
          )
        )
    }
  })
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
  if (providerId === 'gitlab') return 'gitlab'
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
  scopeInput: string | ResourceScope,
  groupId: string,
  requireAccountType = true
): Promise<InvitationContext> {
  const scope = credentialGroupScope(scopeInput)
  const [row] = await db
    .select({
      workspaceId: credentialGroup.workspaceId,
      organizationId: credentialGroup.organizationId,
      organizationName: organization.name,
      workspaceName: workspace.name,
      groupId: credentialGroup.id,
      groupName: credentialGroup.name,
      groupStatus: credentialGroup.status,
      options: credentialGroup.options,
    })
    .from(credentialGroup)
    .leftJoin(workspace, eq(workspace.id, credentialGroup.workspaceId))
    .leftJoin(organization, eq(organization.id, credentialGroup.organizationId))
    .where(and(eq(credentialGroup.id, groupId), resourceScopeCondition(credentialGroup, scope)))
    .limit(1)

  if (!row) throw new CredentialGroupEnrollmentError('Credential group not found', 404)
  if (row.groupStatus !== 'active') {
    throw new CredentialGroupEnrollmentError('Credential group is disabled', 409)
  }
  if (requireAccountType && !row.options.some((option) => option.status === 'active')) {
    const [linkedMcpServer] = await db
      .select({ id: mcpServers.id })
      .from(mcpServers)
      .where(
        and(
          resourceScopeCondition(mcpServers, scope),
          eq(mcpServers.credentialGroupId, groupId),
          eq(mcpServers.authType, 'oauth'),
          eq(mcpServers.enabled, true),
          isNull(mcpServers.deletedAt)
        )
      )
      .limit(1)
    if (!linkedMcpServer) {
      throw new CredentialGroupEnrollmentError(
        'Add an account type or OAuth MCP server before inviting people',
        409
      )
    }
  }
  return {
    ...row,
    ...resourceScopeFields(resourceScopeFromOwner(row)),
    workspaceName: row.organizationName ?? row.workspaceName ?? '',
  }
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
  /** See {@link issueInvitation}: the issuer is attribution, never the authority. */
  userId: string | undefined,
  /** Absent when a workflow issued the invitation — the copy drops the inviter. */
  inviterName: string | undefined,
  email: string,
  options: SendInvitationOptions
): Promise<CredentialGroupEnrollmentRecord> {
  const {
    enrollment: issued,
    invitationLink,
    tokenHash,
  } = await issueInvitation(context, userId, email, options)
  const focusedLink = new URL(invitationLink)
  if (options.searchConnection) {
    focusedLink.searchParams.set('optionId', options.searchConnection.optionId)
    focusedLink.searchParams.set('returnTo', 'search')
  }
  const html = await renderCredentialGroupInvitationEmail({
    recipientEmail: email,
    inviterName,
    workspaceName: context.workspaceName,
    credentialGroupName: context.groupName,
    invitationLink: focusedLink.toString(),
    ...(options.searchConnection
      ? { searchProviderName: options.searchConnection.providerName }
      : {}),
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
  scopeInput: string | ResourceScope,
  groupId: string,
  limit: number,
  cursor?: string,
  filters: ListCredentialGroupEnrollmentFilters = {}
): Promise<{ enrollments: CredentialGroupEnrollmentDetail[]; nextCursor: string | null }> {
  const scope = credentialGroupScope(scopeInput)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ENROLLMENT_PAGE_SIZE) {
    throw new Error(
      `Credential group enrollment limit must be between 1 and ${MAX_ENROLLMENT_PAGE_SIZE}`
    )
  }
  const search = filters.search?.trim() || undefined
  if (search && search.length > 320) {
    throw new CredentialGroupEnrollmentError('People search must be at most 320 characters', 400)
  }
  const [group] = await db
    .select({ options: credentialGroup.options })
    .from(credentialGroup)
    .where(and(eq(credentialGroup.id, groupId), resourceScopeCondition(credentialGroup, scope)))
    .limit(1)
  if (!group) throw new CredentialGroupEnrollmentError('Credential group not found', 404)
  if (
    filters.optionId &&
    !group.options.some((option) => option.id === filters.optionId && option.status === 'active')
  ) {
    throw new CredentialGroupEnrollmentError('Account provider is no longer available', 404)
  }
  const activeOptionIds = group.options
    .filter(
      (option) =>
        option.status === 'active' && (!filters.optionId || option.id === filters.optionId)
    )
    .map((option) => option.id)
  const activeMcpServers = filters.optionId
    ? []
    : await db
        .select({ id: mcpServers.id, name: mcpServers.name })
        .from(mcpServers)
        .where(
          and(
            resourceScopeCondition(mcpServers, scope),
            eq(mcpServers.credentialGroupId, groupId),
            eq(mcpServers.authType, 'oauth'),
            eq(mcpServers.enabled, true),
            isNull(mcpServers.deletedAt)
          )
        )
  const activeMcpServerById = new Map(activeMcpServers.map((server) => [server.id, server]))

  const cursorPosition = cursor ? decodeCredentialGroupEnrollmentCursor(cursor) : undefined

  const rows = await db
    .select({ enrollment: credentialGroupEnrollment })
    .from(credentialGroupEnrollment)
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .where(
      and(
        eq(credentialGroup.id, groupId),
        resourceScopeCondition(credentialGroup, scope),
        filters.email ? eq(credentialGroupEnrollment.email, filters.email) : undefined,
        searchFilter(credentialGroupEnrollment.email, search),
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
  const connectionStatus = sql<'active' | 'needs_reauth' | 'revoked'>`CASE
    WHEN ${credential.type} = 'personal_token' THEN CASE
      WHEN ${credential.revokedAt} IS NOT NULL THEN 'revoked'
      WHEN ${credential.accessTokenExpiresAt} <= now() THEN 'needs_reauth'
      ELSE 'active' END
    ELSE ${credential.managedOauthStatus}::text END`
  const connectionRows =
    enrollmentIds.length === 0
      ? []
      : await db
          .select({
            enrollmentId: credential.credentialGroupEnrollmentId,
            providerId: credential.providerId,
            status: connectionStatus,
            count: count(credential.id),
          })
          .from(credential)
          .where(
            and(
              resourceScopeCondition(credential, scope),
              inArray(credential.credentialGroupEnrollmentId, enrollmentIds),
              or(
                and(
                  eq(credential.type, 'managed_oauth'),
                  inArray(credential.credentialGroupOptionId, activeOptionIds)
                ),
                filters.optionId ? undefined : eq(credential.type, 'personal_token')
              )
            )
          )
          .groupBy(credential.credentialGroupEnrollmentId, credential.providerId, connectionStatus)
          .limit(connectionSummaryLimit + 1)
  if (connectionRows.length > connectionSummaryLimit) {
    throw new Error('Managed credential connection summaries exceed the supported provider states')
  }
  const mcpConnectionSummaryLimit = enrollmentIds.length * activeMcpServers.length
  const mcpConnectionRows =
    enrollmentIds.length === 0 || activeMcpServers.length === 0
      ? []
      : await db
          .select({
            enrollmentId: credential.credentialGroupEnrollmentId,
            mcpServerId: credential.mcpServerId,
            status: credential.managedOauthStatus,
          })
          .from(credential)
          .where(
            and(
              eq(credential.type, 'managed_mcp'),
              inArray(credential.credentialGroupEnrollmentId, enrollmentIds),
              inArray(
                credential.mcpServerId,
                activeMcpServers.map((server) => server.id)
              )
            )
          )
          .limit(mcpConnectionSummaryLimit + 1)
  if (mcpConnectionRows.length > mcpConnectionSummaryLimit) {
    throw new Error('Managed MCP connection summaries exceed the linked server limit')
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
  const mcpConnectionsByEnrollment = new Map<string, CredentialGroupEnrollmentMcpConnection[]>()
  for (const connection of mcpConnectionRows) {
    if (!connection.enrollmentId || !connection.mcpServerId) {
      throw new Error('Managed MCP credential source is missing')
    }
    const server = activeMcpServerById.get(connection.mcpServerId)
    if (!server) throw new Error('Managed MCP credential references an unlinked server')
    const summary: CredentialGroupEnrollmentMcpConnection = {
      mcpServerId: server.id,
      name: server.name,
      status: toCredentialGroupConnectionStatus(connection.status),
    }
    const current = mcpConnectionsByEnrollment.get(connection.enrollmentId)
    if (current) current.push(summary)
    else mcpConnectionsByEnrollment.set(connection.enrollmentId, [summary])
  }
  const nextCursorEnrollment = hasNextPage ? pageRows.at(-1)?.enrollment : undefined
  if (hasNextPage && !nextCursorEnrollment) {
    throw new Error('Credential group enrollment page is missing its cursor boundary')
  }
  return {
    enrollments: pageRows.map(({ enrollment }) => ({
      ...toCredentialGroupEnrollment(enrollment),
      connections: connectionsByEnrollment.get(enrollment.id) ?? [],
      mcpConnections: mcpConnectionsByEnrollment.get(enrollment.id) ?? [],
    })),
    nextCursor: nextCursorEnrollment
      ? encodeCredentialGroupEnrollmentCursor(nextCursorEnrollment)
      : null,
  }
}

export async function inviteCredentialGroupEnrollments(
  scopeInput: string | ResourceScope,
  groupId: string,
  userId: string,
  inviterName: string,
  body: InviteCredentialGroupEnrollmentsInput,
  searchConnection?: { optionId: string; providerName: string }
) {
  const scope = credentialGroupScope(scopeInput)
  const context = await getInvitationContext(scope, groupId)
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
            ...(searchConnection ? { searchConnection } : {}),
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
  scopeInput: string | ResourceScope,
  groupId: string,
  /** See {@link issueInvitation}: the issuer is attribution, never the authority. */
  userId: string | undefined,
  /** See {@link sendInvitation}: absent for a workflow-issued invitation. */
  inviterName: string | undefined,
  email: string,
  /**
   * What a revoked enrollment does to the invitation, decided inside the
   * issuing transaction. An admin's invite reactivates it; an automatic
   * invitation rejects it, so a revocation that lands after the caller read
   * the enrollment is never undone by a stale read.
   */
  revokedEnrollment: RevokedEnrollmentPolicy = 'reactivate'
): Promise<CredentialGroupEnrollmentRecord> {
  const scope = credentialGroupScope(scopeInput)
  const context = await getInvitationContext(scope, groupId)
  return sendInvitation(context, userId, inviterName, normalizeEmail(email), {
    revokedEnrollment,
  })
}

/** A verified workspace member may enroll before saving a personal token, without an OAuth option. */
export async function createCredentialGroupSelfEnrollmentLink(
  scopeInput: string | ResourceScope,
  groupId: string,
  email: string
): Promise<CredentialGroupInvitationLink> {
  const scope = credentialGroupScope(scopeInput)
  const context = await getInvitationContext(scope, groupId, false)
  const issued = await issueInvitation(context, undefined, normalizeEmail(email), {
    revokedEnrollment: 'reject',
  })
  return {
    enrollment: toCredentialGroupEnrollment(issued.enrollment),
    invitationLink: issued.invitationLink,
  }
}

export async function createCredentialGroupInvitationLink(
  scopeInput: string | ResourceScope,
  groupId: string,
  /** See {@link issueInvitation}: the issuer is attribution, never the authority. */
  userId: string | undefined,
  email: string,
  /** See {@link inviteCredentialGroupEnrollment}. */
  revokedEnrollment: RevokedEnrollmentPolicy = 'reactivate'
): Promise<CredentialGroupInvitationLink> {
  const scope = credentialGroupScope(scopeInput)
  const context = await getInvitationContext(scope, groupId)
  const issued = await issueInvitation(context, userId, normalizeEmail(email), {
    revokedEnrollment,
  })
  return {
    enrollment: toCredentialGroupEnrollment(issued.enrollment),
    invitationLink: issued.invitationLink,
  }
}

export async function resendCredentialGroupEnrollment(
  scopeInput: string | ResourceScope,
  groupId: string,
  enrollmentId: string,
  userId: string,
  inviterName: string,
  searchConnection?: { optionId: string; providerName: string }
): Promise<CredentialGroupEnrollmentRecord> {
  const scope = credentialGroupScope(scopeInput)
  const context = await getInvitationContext(scope, groupId)
  const [row] = await db
    .select({ enrollment: credentialGroupEnrollment })
    .from(credentialGroupEnrollment)
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .where(
      and(
        eq(credentialGroupEnrollment.id, enrollmentId),
        eq(credentialGroup.id, groupId),
        resourceScopeCondition(credentialGroup, scope)
      )
    )
    .limit(1)
  if (!row) throw new CredentialGroupEnrollmentError('Enrollment not found', 404)
  return sendInvitation(context, userId, inviterName, row.enrollment.email, {
    expectedEnrollmentId: enrollmentId,
    revokedEnrollment: 'reject',
    ...(searchConnection ? { searchConnection } : {}),
  })
}

export async function deleteCredentialGroupEnrollment(
  scopeInput: string | ResourceScope,
  groupId: string,
  enrollmentId: string
): Promise<{
  credentialGroupEnrollment: CredentialGroupEnrollmentRecord
  retiredMcpConnectionIds: string[]
}> {
  const scope = credentialGroupScope(scopeInput)
  const [existing] = await db
    .select({ email: credentialGroupEnrollment.email })
    .from(credentialGroupEnrollment)
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .where(
      and(
        eq(credentialGroupEnrollment.id, enrollmentId),
        eq(credentialGroup.id, groupId),
        resourceScopeCondition(credentialGroup, scope)
      )
    )
    .limit(1)
  if (!existing) throw new CredentialGroupEnrollmentError('Enrollment not found', 404)

  return db.transaction(async (tx) => {
    await lockCredentialGroupInvitationTarget(tx, groupId, existing.email)
    await lockCredentialGroupEnrollmentLifecycle(tx, enrollmentId)
    const managedMcpConnections = await tx
      .select({ id: credential.id })
      .from(credential)
      .where(
        and(
          eq(credential.type, 'managed_mcp'),
          eq(credential.credentialGroupEnrollmentId, enrollmentId)
        )
      )
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
    return {
      credentialGroupEnrollment: toCredentialGroupEnrollment(deleted),
      retiredMcpConnectionIds: managedMcpConnections.map((row) => row.id),
    }
  })
}

/** Revocation preserves the bound owner and prevents pending callbacks from restoring grants. */
export async function revokeCredentialGroupEnrollment(
  scope: ResourceScope,
  groupId: string,
  enrollmentId: string
) {
  return db.transaction(async (tx) => {
    await lockCredentialGroupEnrollmentLifecycle(tx, enrollmentId)
    const [row] = await tx
      .select({ enrollment: credentialGroupEnrollment })
      .from(credentialGroupEnrollment)
      .innerJoin(
        credentialGroup,
        eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId)
      )
      .where(
        and(
          eq(credentialGroupEnrollment.id, enrollmentId),
          eq(credentialGroup.id, groupId),
          resourceScopeCondition(credentialGroup, scope)
        )
      )
      .limit(1)
      .for('update', { of: credentialGroupEnrollment })
    if (!row) throw new CredentialGroupEnrollmentError('Enrollment not found', 404)
    const now = new Date()
    const credentials = await tx
      .update(credential)
      .set({ managedOauthStatus: 'revoked', revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(credential.credentialGroupEnrollmentId, enrollmentId),
          resourceScopeCondition(credential, scope)
        )
      )
      .returning({ id: credential.id, type: credential.type })
    const [updated] = await tx
      .update(credentialGroupEnrollment)
      .set({ status: 'revoked', revokedAt: now, updatedAt: now })
      .where(eq(credentialGroupEnrollment.id, enrollmentId))
      .returning()
    if (!updated) throw new Error('Enrollment revocation returned no row')
    return {
      credentialGroupEnrollment: toCredentialGroupEnrollment(updated),
      retiredMcpConnectionIds: credentials
        .filter((row) => row.type === 'managed_mcp')
        .map((row) => row.id),
    }
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
  identity: PublicCredentialGroupEnrollmentIdentity,
  projection?: { optionId: string }
): Promise<PublicCredentialGroupEnrollment | null> {
  const row = await resolveAuthorizedPublicEnrollmentRow(identity)
  if (!row) return null

  return buildPublicCredentialGroupEnrollment(row, projection)
}

async function buildPublicCredentialGroupEnrollment(
  row: NonNullable<Awaited<ReturnType<typeof resolvePublicEnrollmentRowByIdentity>>>,
  projection?: { optionId: string }
): Promise<PublicCredentialGroupEnrollment> {
  const [connectionRows, linkedMcpServers, mcpConnectionRows] = await Promise.all([
    db
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
      ),
    db
      .select({
        id: mcpServers.id,
        name: mcpServers.name,
        description: mcpServers.description,
        managedConnectorId: mcpServers.managedConnectorId,
      })
      .from(mcpServers)
      .where(
        and(
          resourceScopeCondition(mcpServers, resourceScopeFromOwner(row)),
          eq(mcpServers.credentialGroupId, row.groupId),
          eq(mcpServers.authType, 'oauth'),
          eq(mcpServers.enabled, true),
          isNull(mcpServers.deletedAt)
        )
      )
      .orderBy(asc(mcpServers.name), asc(mcpServers.id)),
    db
      .select({
        id: credential.id,
        mcpServerId: credential.mcpServerId,
        status: credential.managedOauthStatus,
        grantedAt: credential.grantedAt,
      })
      .from(credential)
      .where(
        and(
          eq(credential.type, 'managed_mcp'),
          eq(credential.credentialGroupEnrollmentId, row.enrollment.id)
        )
      ),
  ])
  const mcpConnectionByServerId = new Map(
    mcpConnectionRows.map((connection) => {
      if (!connection.mcpServerId) throw new Error('Managed MCP credential has no server')
      return [connection.mcpServerId, connection] as const
    })
  )
  const options = projection
    ? row.options.filter(
        (option) => option.id === projection.optionId && option.status === 'active'
      )
    : row.options

  return {
    inviterName: row.inviterName,
    workspaceName: row.workspaceName,
    credentialGroupName: row.groupName,
    options: await Promise.all(
      options.map(async (option) => {
        if (!isCredentialGroupProvider(option.provider)) {
          throw new Error(`Unsupported Credential Group provider: ${option.provider}`)
        }
        const adapter = getCredentialGroupProviderAdapter(option.provider)
        const policy = await adapter.getPolicy(option, {
          ...resourceScopeFields(resourceScopeFromOwner(row)),
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
    mcpServers: (projection ? [] : linkedMcpServers).map((server) => {
      if (!server.managedConnectorId) {
        throw new Error(`Credential Group MCP server ${server.id} has no managed connector ID`)
      }
      const managedConnectorId = getManagedMcpConnector(server.managedConnectorId).id
      const connection = mcpConnectionByServerId.get(server.id)
      if (!connection?.grantedAt) return { ...server, managedConnectorId, connection: null }
      return {
        ...server,
        managedConnectorId,
        connection: {
          id: connection.id,
          status:
            connection.status === 'active'
              ? ('connected' as const)
              : connection.status === 'revoked'
                ? ('revoked' as const)
                : ('needs_reauth' as const),
          grantedAt: connection.grantedAt.toISOString(),
        },
      }
    }),
    status: row.enrollment.status,
  }
}

/** Finalizes an enrollment after the recipient finishes their optional account selections. */
export async function completeCredentialGroupEnrollment(token: string): Promise<true | null> {
  const row = await resolvePublicEnrollmentRowByIdentity({
    invitationTokenHash: hashInvitationToken(token),
  })
  if (!row) return null
  const result = await completeResolvedCredentialGroupEnrollment(
    row,
    identityForPublicEnrollmentRow(row)
  )
  return result?.completed ?? null
}

export async function completeAuthorizedCredentialGroupEnrollment(
  identity: PublicCredentialGroupEnrollmentIdentity
): Promise<CredentialGroupEnrollmentCompletion | null> {
  const row = await resolveAuthorizedPublicEnrollmentRow(identity)
  if (!row) return null
  return completeResolvedCredentialGroupEnrollment(row, identity)
}

async function completeResolvedCredentialGroupEnrollment(
  row: NonNullable<Awaited<ReturnType<typeof resolvePublicEnrollmentRowByIdentity>>>,
  identity: PublicCredentialGroupEnrollmentIdentity
): Promise<CredentialGroupEnrollmentCompletion | null> {
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
          resourceScopeCondition(credentialGroup, resourceScopeFromOwner(identity))
        )
      )
      .limit(1)
      .for('update')
    if (!group || group.status !== 'active') return null

    const transitioned = current.status !== 'completed'

    const [completed] = await tx
      .update(credentialGroupEnrollment)
      .set({
        status: 'completed',
        ...(transitioned ? { completedAt: now } : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(credentialGroupEnrollment.id, row.enrollment.id),
          inArray(credentialGroupEnrollment.status, ['invited', 'in_progress', 'completed'])
        )
      )
      .returning({ id: credentialGroupEnrollment.id })
    if (!completed) throw new Error('Credential group enrollment completion returned no row')
    return { completed: true, transitioned }
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

function loadEnrollmentRowForIdentity(
  identity: Pick<
    PublicCredentialGroupEnrollmentIdentity,
    'workspaceId' | 'organizationId' | 'credentialGroupId' | 'enrollmentId' | 'email' | 'userId'
  >
) {
  return loadLiveEnrollmentRow(
    and(
      eq(credentialGroupEnrollment.id, identity.enrollmentId),
      eq(credentialGroupEnrollment.email, identity.email),
      eq(credentialGroup.id, identity.credentialGroupId),
      resourceScopeCondition(credentialGroup, resourceScopeFromOwner(identity)),
      identity.userId ? eq(credentialGroupEnrollment.userId, identity.userId) : undefined
    )
  )
}

/** Resolves current enrollment authority established by a session or consumed OAuth attempt. */
export async function getCredentialGroupOAuthContextForEnrollment(
  identity: Pick<
    PublicCredentialGroupEnrollmentIdentity,
    'workspaceId' | 'organizationId' | 'credentialGroupId' | 'enrollmentId' | 'email' | 'userId'
  >,
  optionId: string
): Promise<CredentialGroupOAuthContext | null> {
  const row = await loadEnrollmentRowForIdentity(identity)
  if (!row) return null
  const option = row.options.find((candidate) => candidate.id === optionId)
  if (!option || option.status !== 'active') return null
  return credentialGroupOAuthContextFromRow(row, option)
}

export async function getAuthorizedCredentialGroupMcpOAuthContext(
  identity: PublicCredentialGroupEnrollmentIdentity,
  mcpServerId: string
): Promise<CredentialGroupMcpOAuthContext | null> {
  const row = await resolveAuthorizedPublicEnrollmentRow(identity)
  return row ? credentialGroupMcpOAuthContextFromRow(row, mcpServerId) : null
}

/** Resolves a consumed MCP attempt against its current enrollment and linked server. */
export async function getCredentialGroupMcpOAuthContextForEnrollment(
  identity: Pick<
    PublicCredentialGroupEnrollmentIdentity,
    'workspaceId' | 'organizationId' | 'credentialGroupId' | 'enrollmentId' | 'email' | 'userId'
  >,
  mcpServerId: string
): Promise<CredentialGroupMcpOAuthContext | null> {
  const row = await loadEnrollmentRowForIdentity(identity)
  return row ? credentialGroupMcpOAuthContextFromRow(row, mcpServerId) : null
}

async function credentialGroupMcpOAuthContextFromRow(
  row: NonNullable<Awaited<ReturnType<typeof loadLiveEnrollmentRow>>>,
  mcpServerId: string
): Promise<CredentialGroupMcpOAuthContext | null> {
  if (!row.enrollment.userId) return null
  const [server] = await db
    .select({
      id: mcpServers.id,
      name: mcpServers.name,
      url: mcpServers.url,
      managedConnectorId: mcpServers.managedConnectorId,
      oauthConfigVersion: mcpServers.oauthConfigVersion,
    })
    .from(mcpServers)
    .where(
      and(
        eq(mcpServers.id, mcpServerId),
        resourceScopeCondition(mcpServers, resourceScopeFromOwner(row)),
        eq(mcpServers.credentialGroupId, row.groupId),
        eq(mcpServers.authType, 'oauth'),
        eq(mcpServers.enabled, true),
        isNull(mcpServers.deletedAt)
      )
    )
    .limit(1)
  if (!server?.url) return null
  if (!server.managedConnectorId) {
    throw new Error(`Credential Group MCP server ${server.id} has no managed connector ID`)
  }
  getManagedMcpConnector(server.managedConnectorId)
  return {
    enrollmentId: row.enrollment.id,
    userId: row.enrollment.userId,
    credentialGroupId: row.groupId,
    credentialGroupName: row.groupName,
    ...resourceScopeFields(resourceScopeFromOwner(row)),
    email: row.enrollment.email,
    enrollmentStatus: row.enrollment.status,
    server: {
      connectorId: getManagedMcpConnector(server.managedConnectorId).id,
      id: server.id,
      name: server.name,
      url: server.url,
      oauthConfigVersion: server.oauthConfigVersion,
    },
  }
}

function credentialGroupOAuthContextFromRow(
  row: NonNullable<Awaited<ReturnType<typeof resolvePublicEnrollmentRowByIdentity>>>,
  option: CredentialGroupOptionConfig
): CredentialGroupOAuthContext {
  return {
    enrollmentId: row.enrollment.id,
    credentialGroupId: row.groupId,
    credentialGroupName: row.groupName,
    ...resourceScopeFields(resourceScopeFromOwner(row)),
    workspaceName: row.workspaceName,
    workspaceOwnerId: row.workspaceOwnerId,
    credentialOwnerId: row.credentialOwnerId,
    email: row.enrollment.email,
    enrollmentStatus: row.enrollment.status,
    option,
    options: row.options,
  }
}
