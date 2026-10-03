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
import { isPlainRecord } from '@sim/utils/object'
import { normalizeEmail } from '@sim/utils/string'
import { and, asc, eq, gt, inArray, isNull, notExists, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  resourceScopeFields,
  resourceScopeFromOwner,
  sameResourceScope,
} from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import {
  type CredentialGroupCredentialListContext,
  loadScopedAccountsCredentialListContext,
} from '@/lib/credential-groups/credentials'
import { inviteCredentialGroupEnrollment } from '@/lib/credential-groups/enrollments'
import { requireOrganizationAccountsSetup } from '@/lib/credential-groups/organization-setup'
import { CredentialGroupProviderConfigurationError } from '@/lib/credential-groups/provider-adapter'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
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
import { validateKnowledgeConnectorMembersBinding } from '@/lib/knowledge/connectors/member-access'
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
  group: Pick<
    CredentialGroupCredentialListContext,
    'credentialGroupId' | 'status' | 'options'
  > | null
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
  workspaceId?: string
  organizationId?: string
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
    resourceScopeFromOwner(input),
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
  if (input.organizationId) await requireOrganizationAccountsSetup(input.organizationId, group.id)
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
  workspaceId?: string
  organizationId?: string
  connectors: ReadonlyArray<{
    id: string
    connectorType: string
    accessMode: string
    sourceConfig: unknown
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
    ? await resolveKnowledgeAccessAvailability(resourceScopeFields(resourceScopeFromOwner(input)))
    : null
  if (
    !(
      availability?.memberScoped ??
      (await isKnowledgeMemberAccessAvailable(resourceScopeFields(resourceScopeFromOwner(input))))
    )
  )
    return result
  const hasMemberConnectors = input.connectors.some(
    (connector) => connector.accessMode === 'members'
  )
  if (!hasMemberConnectors && !availability?.sourceMirrored) return result
  const group = await loadScopedAccountsCredentialListContext(resourceScopeFromOwner(input))
  if (
    !group ||
    !sameResourceScope(resourceScopeFromOwner(group), resourceScopeFromOwner(input)) ||
    group.status !== 'active'
  )
    return result
  const memberConnectors = input.connectors.flatMap((connector) => {
    const meta = getConnectorMeta(connector.connectorType)
    if (
      connector.accessMode === 'members' &&
      connector.credentialGroupId === group.credentialGroupId &&
      connector.credentialGroupOptionId &&
      meta &&
      isPlainRecord(connector.sourceConfig)
    ) {
      const validation = validateKnowledgeConnectorMembersBinding({
        connectorMeta: meta,
        group,
        credentialGroupOptionId: connector.credentialGroupOptionId,
        sourceConfig: connector.sourceConfig,
      })
      if (!validation.ok) return []
      return [{ id: connector.id, credentialGroupOptionId: connector.credentialGroupOptionId }]
    }
    const identity =
      connector.accessMode === 'admin' && availability?.sourceMirrored
        ? sourceIdentityBinding(meta, group)
        : null
    return identity
      ? [{ id: connector.id, credentialGroupOptionId: identity.credentialGroupOptionId }]
      : []
  })
  if (memberConnectors.length === 0) return result

  const optionIds = new Set(memberConnectors.map((connector) => connector.credentialGroupOptionId))
  const readyOptionIds = new Set(
    (
      await Promise.all(
        group.options
          .filter((option) => optionIds.has(option.id))
          .map(async (option) => {
            if (!isCredentialGroupProvider(option.provider)) return null
            try {
              await getCredentialGroupProviderAdapter(option.provider).getPolicy(option, {
                ...resourceScopeFields(resourceScopeFromOwner(input)),
                credentialGroupId: group.credentialGroupId,
                credentialGroupOptionId: option.id,
              })
              return option.id
            } catch (error) {
              if (error instanceof CredentialGroupProviderConfigurationError) return null
              throw error
            }
          })
      )
    ).filter((optionId) => optionId !== null)
  )
  if (readyOptionIds.size === 0) return result

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
        resourceScopeCondition(credential, resourceScopeFromOwner(input)),
        eq(credential.type, 'managed_oauth')
      )
    )
    .where(
      and(
        resourceScopeCondition(credentialGroup, resourceScopeFromOwner(input)),
        eq(credentialGroup.id, group.credentialGroupId),
        input.organizationId
          ? eq(credentialGroupEnrollment.userId, input.userId)
          : eq(credentialGroupEnrollment.email, email)
      )
    )

  const credentialsByOption = new Map(rows.map((row) => [row.credentialGroupOptionId, row]))
  const enrollmentStatus = rows[0]?.enrollmentStatus ?? null
  for (const connector of memberConnectors) {
    if (!readyOptionIds.has(connector.credentialGroupOptionId)) continue
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
