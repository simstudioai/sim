import { db } from '@sim/db'
import {
  credential,
  credentialGroupEnrollment,
  knowledgeBase,
  knowledgeConnector,
  user,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { resolveSystemBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  createCredentialGroupInvitationLink,
  inviteCredentialGroupEnrollment,
} from '@/lib/credential-groups/enrollments'
import {
  getCredentialGroupProviderId,
  getCredentialGroupStandardOAuthProviderFromProviderId,
  isCredentialGroupProvider,
} from '@/lib/credential-groups/providers'
import { createCredentialGroup, listCredentialGroups } from '@/lib/credential-groups/service'
import { isKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import { dispatchMemberSync } from '@/lib/knowledge/connectors/member-queue'
import { getUsersWithPermissions } from '@/lib/workspaces/permissions/utils'
import type { ConnectorMeta } from '@/connectors/types'

const logger = createLogger('KnowledgeConnectorMemberProvisioning')

/** Invitations sent between two lease heartbeats of a member run. */
const INVITATION_BATCH_SIZE = 25
/** Names tried for the group a connector provisions, in order. */
const PROVISIONED_GROUP_NAME_ATTEMPTS = 5

export interface ProvisionedMembersBinding {
  credentialGroupId: string
  credentialGroupOptionId: string
}

/**
 * The name of the group a connector provisions: the connector's own name,
 * which is what the invitation email and the enrollment page show, suffixed
 * only when the workspace already uses it.
 */
export function pickProvisionedGroupName(
  connectorName: string,
  takenNames: readonly string[]
): string {
  const taken = new Set(takenNames.map((name) => name.trim().toLocaleLowerCase()))
  for (let attempt = 1; attempt <= PROVISIONED_GROUP_NAME_ATTEMPTS; attempt++) {
    const candidate = attempt === 1 ? connectorName : `${connectorName} ${attempt}`
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate
  }
  throw new OrchestrationError(
    'conflict',
    `Every name from "${connectorName}" to "${connectorName} ${PROVISIONED_GROUP_NAME_ATTEMPTS}" is taken; pick a Credential Group in Settings`
  )
}

/**
 * The Credential Group option a members-mode connector crawls through when
 * the caller named none: the workspace's one active option collecting the
 * connector's accounts, or a group created for the purpose. Two or more
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
      candidates.push({ credentialGroupId: group.id, credentialGroupOptionId: option.id })
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
  return { credentialGroupId: group.id, credentialGroupOptionId: option.id }
}

export interface InviteWorkspaceMembersResult {
  invited: number
  failed: number
}

/**
 * Invites every workspace member who has no enrollment in the group yet, so
 * joining the workspace is all a person has to do before connecting their
 * account. An enrollment an admin revoked is left alone. Runs inside a member
 * run: `beforeBatch` beats the run's lease between batches, and failures are
 * logged per person rather than aborting the run.
 */
export async function inviteWorkspaceMembersToCredentialGroup(input: {
  workspaceId: string
  credentialGroupId: string
  beforeBatch: () => Promise<void>
}): Promise<InviteWorkspaceMembersResult> {
  const [members, enrolled] = await Promise.all([
    getUsersWithPermissions(input.workspaceId),
    db
      .select({ email: credentialGroupEnrollment.email })
      .from(credentialGroupEnrollment)
      .where(eq(credentialGroupEnrollment.credentialGroupId, input.credentialGroupId)),
  ])
  const enrolledEmails = new Set(enrolled.map((row) => row.email.trim().toLocaleLowerCase()))
  const pending = [
    ...new Set(members.map((member) => member.email.trim().toLocaleLowerCase())),
  ].filter((email) => email && !enrolledEmails.has(email))

  const result: InviteWorkspaceMembersResult = { invited: 0, failed: 0 }
  for (let offset = 0; offset < pending.length; offset += INVITATION_BATCH_SIZE) {
    await input.beforeBatch()
    for (const email of pending.slice(offset, offset + INVITATION_BATCH_SIZE)) {
      try {
        await inviteCredentialGroupEnrollment(
          input.workspaceId,
          input.credentialGroupId,
          undefined,
          undefined,
          email
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
 * The viewer's membership in each members-mode connector, keyed by connector
 * id. Connectors that sync as the workspace are absent, and so is everything
 * where the feature is off: there is nothing the viewer could connect to.
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
  if (!(await isKnowledgeMemberAccessAvailable({ workspaceId: input.workspaceId }))) return result

  const [viewer] = await db
    .select({ email: user.email, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1)
  if (!viewer) return result
  const email = viewer.email.trim().toLocaleLowerCase()
  const groupIds = [...new Set(memberConnectors.map((connector) => connector.credentialGroupId!))]
  const rows = await db
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
        emailVerified: viewer.emailVerified,
        enrollmentStatus: enrollment?.enrollmentStatus ?? null,
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
 * which could connect but would never be granted a token.
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
  const email = viewer.email.trim().toLocaleLowerCase()
  const [enrollment] = await db
    .select({ status: credentialGroupEnrollment.status })
    .from(credentialGroupEnrollment)
    .where(
      and(
        eq(credentialGroupEnrollment.credentialGroupId, input.credentialGroupId),
        eq(credentialGroupEnrollment.email, email)
      )
    )
    .limit(1)
  if (enrollment?.status === 'revoked') {
    throw new OrchestrationError(
      'forbidden',
      'A workspace admin removed your access to this connector'
    )
  }
  const { invitationLink } = await createCredentialGroupInvitationLink(
    input.workspaceId,
    input.credentialGroupId,
    undefined,
    email
  )
  return invitationLink
}

/**
 * Queues a member run for every connector that crawls through the option a
 * member just connected, so their documents arrive within minutes rather
 * than at the next scheduled run. Best effort: a refused dispatch is logged
 * and the schedule catches up.
 */
export async function dispatchMemberSyncsForCredentialOption(input: {
  workspaceId: string
  credentialGroupOptionId: string
  requestId?: string
}): Promise<void> {
  const connectors = await db
    .select({ id: knowledgeConnector.id })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
    .where(
      and(
        eq(knowledgeBase.workspaceId, input.workspaceId),
        isNull(knowledgeBase.deletedAt),
        eq(knowledgeConnector.accessMode, 'members'),
        eq(knowledgeConnector.credentialGroupOptionId, input.credentialGroupOptionId),
        eq(knowledgeConnector.status, 'active'),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt)
      )
    )
  if (connectors.length === 0) return
  const billingAttribution = await resolveSystemBillingAttribution(input.workspaceId)
  for (const connector of connectors) {
    const dispatch = await dispatchMemberSync(connector.id, {
      billingAttribution,
      requestId: input.requestId,
    })
    if (!dispatch.queued) {
      logger.info('Member sync after a member connected was not queued', {
        connectorId: connector.id,
        reason: dispatch.reason,
      })
    }
  }
}
