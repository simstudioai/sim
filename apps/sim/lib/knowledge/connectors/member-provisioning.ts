import { db } from '@sim/db'
import { credential, credentialGroupEnrollment, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, inArray } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  createCredentialGroupInvitationLink,
  inviteCredentialGroupEnrollment,
  loadCredentialGroupInviterIdentity,
} from '@/lib/credential-groups/enrollments'
import {
  getCredentialGroupProviderId,
  getCredentialGroupStandardOAuthProviderFromProviderId,
  isCredentialGroupProvider,
} from '@/lib/credential-groups/providers'
import { createCredentialGroup, listCredentialGroups } from '@/lib/credential-groups/service'
import { getUsersWithPermissions } from '@/lib/workspaces/permissions/utils'
import type { ConnectorMeta } from '@/connectors/types'

const logger = createLogger('KnowledgeConnectorMemberProvisioning')

/** Invitations one request sends before handing the rest to the member run. */
export const MEMBER_PROVISION_INVITES_PER_REQUEST = 25
/** Invitations one member run sends, so a large workspace is covered within a few runs. */
export const MEMBER_PROVISION_INVITES_PER_RUN = 100
/** Names tried for the group a connector provisions, in order. */
const PROVISIONED_GROUP_NAME_ATTEMPTS = 5

export interface ProvisionedMembersBinding {
  credentialGroupId: string
  credentialGroupOptionId: string
  /** Whether this call created the group rather than reusing one. */
  created: boolean
}

/**
 * The group name a connector provisions for its provider: the connector's
 * name, suffixed until it is free of the workspace's existing group names.
 */
export function pickProvisionedGroupName(
  connectorName: string,
  takenNames: readonly string[]
): string {
  const taken = new Set(takenNames.map((name) => name.trim().toLocaleLowerCase()))
  const base = `${connectorName} access`
  for (let attempt = 1; attempt <= PROVISIONED_GROUP_NAME_ATTEMPTS; attempt++) {
    const candidate = attempt === 1 ? base : `${base} ${attempt}`
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate
  }
  throw new OrchestrationError(
    'conflict',
    `Every name from "${base}" to "${base} ${PROVISIONED_GROUP_NAME_ATTEMPTS}" is taken; pick a Credential Group in Settings`
  )
}

/**
 * The Credential Group option a members-mode connector should crawl through
 * when the caller named none: the workspace's one active option collecting
 * the connector's accounts, or a group created for the purpose. Two or more
 * candidate options is an ambiguity the caller has to resolve by naming one.
 */
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
  let provider: ReturnType<typeof getCredentialGroupStandardOAuthProviderFromProviderId>
  try {
    provider = getCredentialGroupStandardOAuthProviderFromProviderId(providerId)
  } catch {
    throw new OrchestrationError(
      'validation',
      `${connectorMeta.name} accounts cannot be collected through a Credential Group yet`
    )
  }

  const groups = await listCredentialGroups(input.workspaceId)
  const candidates: ProvisionedMembersBinding[] = []
  for (const group of groups) {
    if (group.status !== 'active') continue
    for (const option of group.options) {
      if (option.status !== 'active') continue
      if (!isCredentialGroupProvider(option.provider)) continue
      if (getCredentialGroupProviderId(option.provider) !== providerId) continue
      candidates.push({
        credentialGroupId: group.id,
        credentialGroupOptionId: option.id,
        created: false,
      })
    }
  }
  if (candidates.length === 1) return candidates[0]
  if (candidates.length > 1) {
    throw new OrchestrationError(
      'validation',
      `Several Credential Groups collect ${connectorMeta.name} accounts; choose which one this connector syncs through`
    )
  }

  const name = pickProvisionedGroupName(
    connectorMeta.name,
    groups.map((group) => group.name)
  )
  const group = await createCredentialGroup(input.workspaceId, input.userId, {
    name,
    options: [{ provider, label: connectorMeta.name, required: true }],
  })
  const option = group.options[0]
  if (!option) throw new Error('Provisioned Credential Group has no option')
  logger.info('Provisioned a Credential Group for a members-mode connector', {
    workspaceId: input.workspaceId,
    credentialGroupId: group.id,
    provider,
  })
  return { credentialGroupId: group.id, credentialGroupOptionId: option.id, created: true }
}

export interface InviteWorkspaceMembersResult {
  invited: number
  failed: number
  /** Members left uninvited because the limit was reached; the next call continues. */
  remaining: number
}

/**
 * Invites every workspace member who has no enrollment in the group yet, up
 * to `limit`, so joining the workspace is all a person has to do before
 * connecting their account. An enrollment an admin revoked is left alone.
 * Failures are logged per person and never abort the caller.
 */
export async function inviteWorkspaceMembersToCredentialGroup(input: {
  workspaceId: string
  credentialGroupId: string
  inviterUserId: string | undefined
  limit: number
}): Promise<InviteWorkspaceMembersResult> {
  const [members, enrolled, inviter] = await Promise.all([
    getUsersWithPermissions(input.workspaceId),
    db
      .select({ email: credentialGroupEnrollment.email })
      .from(credentialGroupEnrollment)
      .where(eq(credentialGroupEnrollment.credentialGroupId, input.credentialGroupId)),
    input.inviterUserId
      ? loadCredentialGroupInviterIdentity(input.inviterUserId)
      : Promise.resolve(null),
  ])
  const enrolledEmails = new Set(enrolled.map((row) => row.email.trim().toLocaleLowerCase()))
  const pending = members
    .map((member) => member.email.trim().toLocaleLowerCase())
    .filter((email, index, all) => email && all.indexOf(email) === index)
    .filter((email) => !enrolledEmails.has(email))
  const batch = pending.slice(0, input.limit)
  const inviterName = inviter?.name ?? inviter?.email ?? undefined

  let invited = 0
  let failed = 0
  for (const email of batch) {
    try {
      await inviteCredentialGroupEnrollment(
        input.workspaceId,
        input.credentialGroupId,
        input.inviterUserId,
        inviterName,
        email
      )
      invited += 1
    } catch (error) {
      failed += 1
      logger.warn('Failed to invite a workspace member to a connector credential group', {
        workspaceId: input.workspaceId,
        credentialGroupId: input.credentialGroupId,
        error: getErrorMessage(error),
      })
    }
  }
  return { invited, failed, remaining: pending.length - batch.length }
}

export type ViewerConnectorMembership = 'connected' | 'needs_reauth' | 'invited' | 'not_enrolled'

/**
 * Where a viewer stands with a members-mode connector, from their enrollment
 * and managed credential for the connector's option.
 */
export function deriveViewerConnectorMembership(input: {
  enrollmentStatus: string | null
  managedOauthStatus: string | null
}): ViewerConnectorMembership {
  if (input.managedOauthStatus === 'active') return 'connected'
  if (input.managedOauthStatus === 'needs_reauth') return 'needs_reauth'
  if (
    input.enrollmentStatus === 'invited' ||
    input.enrollmentStatus === 'delivery_failed' ||
    input.enrollmentStatus === 'in_progress' ||
    input.enrollmentStatus === 'completed'
  ) {
    return 'invited'
  }
  return 'not_enrolled'
}

/**
 * The viewer's membership in each members-mode connector, keyed by connector
 * id. Connectors that sync as the workspace are absent.
 */
export async function resolveViewerConnectorMemberships(input: {
  userId: string
  workspaceId: string
  connectors: ReadonlyArray<{
    id: string
    accessMode: string
    credentialGroupId: string | null
    credentialGroupOptionId: string | null
  }>
}): Promise<Map<string, ViewerConnectorMembership>> {
  const result = new Map<string, ViewerConnectorMembership>()
  const memberConnectors = input.connectors.filter(
    (connector) =>
      connector.accessMode === 'members' &&
      connector.credentialGroupId &&
      connector.credentialGroupOptionId
  )
  if (memberConnectors.length === 0) return result

  const [viewer] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1)
  const email = viewer?.email.trim().toLocaleLowerCase()
  const groupIds = [...new Set(memberConnectors.map((connector) => connector.credentialGroupId!))]
  const rows = email
    ? await db
        .select({
          credentialGroupId: credentialGroupEnrollment.credentialGroupId,
          enrollmentStatus: credentialGroupEnrollment.status,
          credentialGroupOptionId: credential.credentialGroupOptionId,
          managedOauthStatus: credential.managedOauthStatus,
        })
        .from(credentialGroupEnrollment)
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
            inArray(credentialGroupEnrollment.credentialGroupId, groupIds),
            eq(credentialGroupEnrollment.email, email)
          )
        )
    : []

  for (const connector of memberConnectors) {
    const enrollment = rows.find((row) => row.credentialGroupId === connector.credentialGroupId)
    const forOption = rows.find(
      (row) =>
        row.credentialGroupId === connector.credentialGroupId &&
        row.credentialGroupOptionId === connector.credentialGroupOptionId
    )
    result.set(
      connector.id,
      deriveViewerConnectorMembership({
        enrollmentStatus: enrollment?.enrollmentStatus ?? null,
        managedOauthStatus: forOption?.managedOauthStatus ?? null,
      })
    )
  }
  return result
}

/**
 * A fresh enrollment link for the viewer into the connector's group, created
 * on demand so a workspace member never has to find the invitation email.
 */
export async function createViewerConnectorEnrollmentLink(input: {
  userId: string
  workspaceId: string
  credentialGroupId: string
}): Promise<string> {
  const [viewer] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1)
  if (!viewer) throw new OrchestrationError('not_found', 'User not found')
  const { invitationLink } = await createCredentialGroupInvitationLink(
    input.workspaceId,
    input.credentialGroupId,
    input.userId,
    viewer.email
  )
  return invitationLink
}
