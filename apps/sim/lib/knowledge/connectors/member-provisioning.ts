import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  foldedEmail,
  member,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { ORG_ADMIN_ROLES } from '@sim/platform-authz/workspace'
import { getErrorMessage } from '@sim/utils/errors'
import { normalizeEmail } from '@sim/utils/string'
import { and, asc, eq, gt, inArray, isNull, notExists, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type CredentialGroupCredentialListContext,
  loadWorkspaceAccountsCredentialListContext,
} from '@/lib/credential-groups/credentials'
import {
  CredentialGroupEnrollmentError,
  createCredentialGroupInvitationLink,
  inviteCredentialGroupEnrollment,
} from '@/lib/credential-groups/enrollments'
import {
  findCredentialGroupProviderFromProviderId,
  getCredentialGroupProviderId,
  isCredentialGroupProvider,
  isCredentialGroupStandardOAuthProvider,
} from '@/lib/credential-groups/providers'
import { ensureWorkspaceAccountsGroup } from '@/lib/credential-groups/service'
import {
  isKnowledgeMemberAccessAvailable,
  resolveKnowledgeAccessAvailability,
} from '@/lib/knowledge/access/availability'
import { getConnectorMeta } from '@/connectors/registry'
import type { ConnectorMeta } from '@/connectors/types'

const logger = createLogger('KnowledgeConnectorMemberProvisioning')

/** Invitations sent between two lease heartbeats of a member run. */
const INVITATION_BATCH_SIZE = 25

export interface ProvisionedMembersBinding {
  credentialGroupId: string
  credentialGroupOptionId: string
}

/** An identity connection proves who may read mirrored ACLs; it grants no crawler token access. */
export function sourceIdentityBinding(
  connectorMeta: ConnectorMeta | undefined,
  group: CredentialGroupCredentialListContext | null
): ProvisionedMembersBinding | null {
  if (
    !connectorMeta?.mirrorsSourceAcls ||
    !connectorMeta.requiresMemberIdentity ||
    connectorMeta.auth.mode !== 'oauth' ||
    group?.status !== 'active'
  )
    return null
  const providerId = connectorMeta.auth.provider
  const options = group.options.filter(
    (option) =>
      option.status === 'active' &&
      isCredentialGroupProvider(option.provider) &&
      getCredentialGroupProviderId(option.provider) === providerId
  )
  return options.length === 1
    ? { credentialGroupId: group.credentialGroupId, credentialGroupOptionId: options[0]!.id }
    : null
}

export async function provisionKnowledgeConnectorMembersBinding(input: {
  workspaceId: string
  connectorMeta: Pick<ConnectorMeta, 'name' | 'auth'>
  userId: string
}): Promise<ProvisionedMembersBinding> {
  const { connectorMeta } = input
  if (connectorMeta.auth.mode !== 'oauth') {
    throw new OrchestrationError('validation', 'Only an OAuth connector can sync per member')
  }
  const providerId = connectorMeta.auth.provider
  const provider = findCredentialGroupProviderFromProviderId(providerId)
  if (!provider) {
    throw new OrchestrationError(
      'validation',
      `${connectorMeta.name} accounts cannot be collected through a Credential Group yet`
    )
  }

  const group = await ensureWorkspaceAccountsGroup(
    input.workspaceId,
    input.userId,
    isCredentialGroupStandardOAuthProvider(provider)
      ? { provider, label: connectorMeta.name, required: false }
      : undefined
  )
  const options = group.options.filter(
    (option) =>
      option.provider === provider &&
      option.status === 'active' &&
      option.configurationStatus === 'ready'
  )
  if (options.length !== 1) {
    throw new OrchestrationError(
      'validation',
      `Configure ${connectorMeta.name} member sign-in in ${group.name} in Settings before connecting this source`
    )
  }
  return { credentialGroupId: group.id, credentialGroupOptionId: options[0]!.id }
}

export interface InviteWorkspaceMembersResult {
  invited: number
  failed: number
}

/**
 * Invites every workspace member who has no enrollment in the group yet, so
 * joining the workspace is all a person has to do before connecting their
 * account. An enrollment an admin revoked is left alone — the invitation is
 * issued with `reject`, so a revocation that lands after the enrollments were
 * read is refused inside the issuing transaction rather than reactivated.
 * Runs inside a member run: `beforeBatch` beats the run's lease between
 * batches, and failures are logged per person rather than aborting the run.
 */
export async function inviteWorkspaceMembersToCredentialGroup(input: {
  workspaceId: string
  credentialGroupId: string
  beforeBatch: () => Promise<void>
  deadlineAt?: number
}): Promise<InviteWorkspaceMembersResult> {
  const result: InviteWorkspaceMembersResult = { invited: 0, failed: 0 }
  const [scope] = await db
    .select({ organizationId: workspace.organizationId })
    .from(workspace)
    .where(and(eq(workspace.id, input.workspaceId), isNull(workspace.archivedAt)))
    .limit(1)
  if (!scope) return result
  const memberIds = sql`(
    SELECT ${permissions.userId} FROM ${permissions}
    WHERE ${permissions.entityType} = 'workspace' AND ${permissions.entityId} = ${input.workspaceId}
    UNION
    SELECT ${member.userId} FROM ${member}
    WHERE ${member.organizationId} = ${scope.organizationId} AND ${inArray(member.role, [...ORG_ADMIN_ROLES])}
  )`
  let cursor: string | undefined
  for (;;) {
    if (input.deadlineAt !== undefined && Date.now() >= input.deadlineAt) break
    await input.beforeBatch()
    const pending = await db
      .select({ id: user.id, email: foldedEmail(user.email) })
      .from(user)
      .where(
        and(
          inArray(user.id, memberIds),
          cursor ? gt(user.id, cursor) : undefined,
          sql`${foldedEmail(user.email)} <> ''`,
          notExists(
            db
              .select({ id: credentialGroupEnrollment.id })
              .from(credentialGroupEnrollment)
              .where(
                and(
                  eq(credentialGroupEnrollment.credentialGroupId, input.credentialGroupId),
                  eq(credentialGroupEnrollment.email, foldedEmail(user.email))
                )
              )
          )
        )
      )
      .orderBy(asc(user.id))
      .limit(INVITATION_BATCH_SIZE)
    if (pending.length === 0) break
    for (const email of new Set(pending.map((row) => row.email))) {
      if (input.deadlineAt !== undefined && Date.now() >= input.deadlineAt) return result
      try {
        await inviteCredentialGroupEnrollment(
          input.workspaceId,
          input.credentialGroupId,
          undefined,
          undefined,
          email,
          'reject'
        )
        result.invited += 1
      } catch (error) {
        result.failed += 1
        logger.warn('Failed to invite a workspace member to a connector credential group', {
          workspaceId: input.workspaceId,
          credentialGroupId: input.credentialGroupId,
          error: getErrorMessage(error),
        })
      }
    }
    cursor = pending.at(-1)!.id
    if (pending.length < INVITATION_BATCH_SIZE) break
  }
  return result
}

/**
 * Where a viewer stands with a members-mode connector, from their account
 * and their enrollment in the connector's group.
 */
export type ViewerConnectorMembership =
  | 'connected'
  | 'needs_reauth'
  | 'invited'
  | 'not_enrolled'
  | 'revoked'
  | 'unverified_email'

export function deriveViewerConnectorMembership(input: {
  emailVerified: boolean
  enrollmentStatus: string | null
  managedOauthStatus: string | null
}): ViewerConnectorMembership {
  if (!input.emailVerified) return 'unverified_email'
  if (input.enrollmentStatus === 'revoked') return 'revoked'
  if (input.managedOauthStatus === 'active') return 'connected'
  if (input.managedOauthStatus === 'needs_reauth') return 'needs_reauth'
  if (input.enrollmentStatus) return 'invited'
  return 'not_enrolled'
}

/**
 * The viewer's account status for per-member crawls and source identity connections.
 * Workspace-wide sources never offer enrollment; source identities do not create crawler grants.
 */
export async function resolveViewerConnectorMemberships(input: {
  userId: string
  workspaceId: string
  connectors: ReadonlyArray<{
    id: string
    connectorType?: string
    accessMode: string
    credentialGroupId: string | null
    credentialGroupOptionId: string | null
  }>
}): Promise<Map<string, ViewerConnectorMembership>> {
  const result = new Map<string, ViewerConnectorMembership>()
  if (input.connectors.length === 0) return result
  const identitySources = input.connectors.some(
    (connector) =>
      connector.accessMode === 'admin' &&
      connector.connectorType &&
      getConnectorMeta(connector.connectorType)?.requiresMemberIdentity
  )
  const availability = identitySources
    ? await resolveKnowledgeAccessAvailability({ workspaceId: input.workspaceId })
    : null
  if (
    !(
      availability?.memberScoped ??
      (await isKnowledgeMemberAccessAvailable({ workspaceId: input.workspaceId }))
    )
  )
    return result
  const identityGroup = availability?.sourceMirrored
    ? await loadWorkspaceAccountsCredentialListContext(input.workspaceId)
    : null
  const memberConnectors = input.connectors.flatMap((connector) => {
    if (
      connector.accessMode === 'members' &&
      connector.credentialGroupId &&
      connector.credentialGroupOptionId
    ) {
      return [{ id: connector.id, credentialGroupOptionId: connector.credentialGroupOptionId }]
    }
    const identity =
      connector.accessMode === 'admin' && connector.connectorType
        ? sourceIdentityBinding(getConnectorMeta(connector.connectorType), identityGroup)
        : null
    return identity
      ? [{ id: connector.id, credentialGroupOptionId: identity.credentialGroupOptionId }]
      : []
  })
  if (memberConnectors.length === 0) return result

  const [viewer] = await db
    .select({ email: user.email, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1)
  if (!viewer) return result
  const email = normalizeEmail(viewer.email)
  const rows = await db
    .select({
      enrollmentStatus: credentialGroupEnrollment.status,
      credentialGroupOptionId: credential.credentialGroupOptionId,
      managedOauthStatus: credential.managedOauthStatus,
    })
    .from(credentialGroupEnrollment)
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .leftJoin(
      credential,
      and(
        eq(credential.credentialGroupEnrollmentId, credentialGroupEnrollment.id),
        eq(credential.workspaceId, input.workspaceId),
        eq(credential.type, 'managed_oauth')
      )
    )
    .where(
      and(
        eq(credentialGroup.workspaceId, input.workspaceId),
        eq(credentialGroupEnrollment.email, email)
      )
    )

  const credentialsByOption = new Map(rows.map((row) => [row.credentialGroupOptionId, row]))
  const enrollmentStatus = rows[0]?.enrollmentStatus ?? null
  for (const connector of memberConnectors) {
    const forOption = credentialsByOption.get(connector.credentialGroupOptionId)
    result.set(
      connector.id,
      deriveViewerConnectorMembership({
        emailVerified: viewer.emailVerified,
        enrollmentStatus,
        managedOauthStatus: forOption?.managedOauthStatus ?? null,
      })
    )
  }
  return result
}

/**
 * A fresh enrollment link for the viewer into the connector's group, minted
 * on demand so a workspace member never has to find the invitation email.
 * Issued without an inviter — the person is inviting themselves — and refused
 * for an enrollment an admin revoked or an account whose email is unverified,
 * which could connect but would never be granted a token. The revocation is
 * decided inside the issuing transaction (`reject`), so an admin who revokes
 * between the read here and the issue is never overridden by a link.
 */
export async function createViewerConnectorEnrollmentLink(input: {
  userId: string
  workspaceId: string
  credentialGroupId: string
}): Promise<string> {
  const [viewer] = await db
    .select({ email: user.email, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1)
  if (!viewer) throw new OrchestrationError('not_found', 'User not found')
  if (!viewer.emailVerified) {
    throw new OrchestrationError(
      'validation',
      'Verify your email address before connecting an account'
    )
  }
  const email = normalizeEmail(viewer.email)
  const revoked = new OrchestrationError(
    'forbidden',
    'A workspace admin removed your access to this connector'
  )
  if (await isEnrollmentRevoked(input.credentialGroupId, email)) throw revoked
  try {
    const { invitationLink } = await createCredentialGroupInvitationLink(
      input.workspaceId,
      input.credentialGroupId,
      undefined,
      email,
      'reject'
    )
    return invitationLink
  } catch (error) {
    /** The issue refused a revocation that landed after the read above; report it as such. */
    if (
      error instanceof CredentialGroupEnrollmentError &&
      error.status === 409 &&
      (await isEnrollmentRevoked(input.credentialGroupId, email))
    ) {
      throw revoked
    }
    throw error
  }
}

async function isEnrollmentRevoked(credentialGroupId: string, email: string): Promise<boolean> {
  const [enrollment] = await db
    .select({ status: credentialGroupEnrollment.status })
    .from(credentialGroupEnrollment)
    .where(
      and(
        eq(credentialGroupEnrollment.credentialGroupId, credentialGroupId),
        eq(credentialGroupEnrollment.email, email)
      )
    )
    .limit(1)
  return enrollment?.status === 'revoked'
}
