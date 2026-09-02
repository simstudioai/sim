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
import { normalizeEmail } from '@sim/utils/string'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  CredentialGroupEnrollmentError,
  createCredentialGroupInvitationLink,
  inviteCredentialGroupEnrollment,
} from '@/lib/credential-groups/enrollments'
import {
  type CredentialGroupProvider,
  getCredentialGroupProviderFromProviderId,
  getCredentialGroupProviderId,
  isCredentialGroupProvider,
  isCredentialGroupStandardOAuthProvider,
} from '@/lib/credential-groups/providers'
import { createCredentialGroup, listCredentialGroups } from '@/lib/credential-groups/service'
import { isKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
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
 * Among the workspace's active options collecting the connector's accounts,
 * the one other members-mode connectors already sync through, so one
 * connection serves every connector of a provider. A group nobody syncs
 * through is never reused: it was curated for something else, and joining
 * it would invite the whole workspace to it. Returns `undefined` when a new
 * group is needed and `null` when two shared options make the choice
 * ambiguous.
 */
export function chooseSharedMembersBinding(
  candidates: readonly ProvisionedMembersBinding[],
  optionIdsServingMemberConnectors: ReadonlySet<string>
): ProvisionedMembersBinding | null | undefined {
  const shared = candidates.filter((candidate) =>
    optionIdsServingMemberConnectors.has(candidate.credentialGroupOptionId)
  )
  if (shared.length === 1) return shared[0]
  return shared.length > 1 ? null : undefined
}

async function listOptionIdsServingMemberConnectors(
  workspaceId: string,
  optionIds: readonly string[]
): Promise<ReadonlySet<string>> {
  if (optionIds.length === 0) return new Set()
  const rows = await db
    .select({ optionId: knowledgeConnector.credentialGroupOptionId })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
    .where(
      and(
        eq(knowledgeBase.workspaceId, workspaceId),
        eq(knowledgeConnector.accessMode, 'members'),
        inArray(knowledgeConnector.credentialGroupOptionId, [...optionIds]),
        isNull(knowledgeConnector.deletedAt)
      )
    )
  return new Set(rows.flatMap((row) => (row.optionId ? [row.optionId] : [])))
}

/**
 * The Credential Group option a members-mode connector crawls through when
 * the caller named none: the option this provider's other members-mode
 * connectors share, or a group created for the purpose.
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
  let provider: CredentialGroupProvider
  try {
    provider = getCredentialGroupProviderFromProviderId(providerId)
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
      if (option.status !== 'active' || option.configurationStatus !== 'ready') continue
      if (!isCredentialGroupProvider(option.provider)) continue
      if (getCredentialGroupProviderId(option.provider) !== providerId) continue
      candidates.push({ credentialGroupId: group.id, credentialGroupOptionId: option.id })
    }
  }
  const shared = chooseSharedMembersBinding(
    candidates,
    await listOptionIdsServingMemberConnectors(
      input.workspaceId,
      candidates.map((candidate) => candidate.credentialGroupOptionId)
    )
  )
  if (shared) return shared
  if (shared === null) {
    throw new OrchestrationError(
      'validation',
      `Several Credential Groups collect ${connectorMeta.name} accounts for other connectors; choose which one this connector syncs through`
    )
  }

  if (!isCredentialGroupStandardOAuthProvider(provider)) {
    /**
     * A Slack option authorizes through the workspace's own Slack app, which
     * only an admin can configure in Settings, so no group can be created
     * here. The one option already set up for it is what the connector was
     * meant to crawl through; anything else needs the admin's choice.
     */
    if (candidates.length === 1) return candidates[0]
    throw new OrchestrationError(
      'validation',
      candidates.length === 0
        ? `Add a ${connectorMeta.name} option to a Credential Group in Settings, using your own ${connectorMeta.name} app, then connect again`
        : `Several Credential Groups collect ${connectorMeta.name} accounts; choose which one this connector syncs through`
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
}): Promise<InviteWorkspaceMembersResult> {
  const [members, enrolled] = await Promise.all([
    getUsersWithPermissions(input.workspaceId),
    db
      .select({ email: credentialGroupEnrollment.email })
      .from(credentialGroupEnrollment)
      .where(eq(credentialGroupEnrollment.credentialGroupId, input.credentialGroupId)),
  ])
  const enrolledEmails = new Set(enrolled.map((row) => normalizeEmail(row.email)))
  const pending = [...new Set(members.map((member) => normalizeEmail(member.email)))].filter(
    (email) => email && !enrolledEmails.has(email)
  )

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
  const email = normalizeEmail(viewer.email)
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
