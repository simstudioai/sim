import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  type CredentialGroupOptionConfig,
  credentialGroup,
  knowledgeBase,
  knowledgeConnector,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ResourceOwner,
  resourceScopeFields,
  resourceScopeFromOwner,
  sameResourceScope,
} from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import {
  type CredentialGroupKnowledgeConnectorAccess,
  compileCredentialGroupWorkflowAccessPolicy,
  credentialGroupWorkflowAccessPolicyCodec,
  decodeCredentialGroupKnowledgeConnectorAccess,
  decodeCredentialGroupWorkflowAccessPolicy,
  evaluateCredentialGroupKnowledgeConnectorAccess,
} from '@/lib/credential-groups/application/workflow-access-policy'
import {
  type CredentialGroupCredentialListContext,
  type CredentialGroupOptionCredentialReference,
  isManagedCredentialGroupBindingLive,
  listCredentialGroupOptionCredentialReferences,
  loadManagedCredentialGroupBinding,
} from '@/lib/credential-groups/credentials'
import { CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_LIMIT } from '@/lib/credential-groups/limits'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import {
  getCredentialGroupProviderId,
  isCredentialGroupProvider,
} from '@/lib/credential-groups/providers'
import {
  type ResolvedManagedOAuthToken,
  rejectManagedOAuthToken,
  resolveManagedOAuthToken,
} from '@/lib/credentials/managed-oauth'
import { MEMBER_LOCKABLE_CONNECTOR_STATUSES } from '@/lib/knowledge/connectors/sync-lock'
import {
  CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION,
  type ResourcePolicyBindingFor,
} from '@/lib/resource-policies/registry'
import {
  ResourcePolicyNotFoundError,
  ResourcePolicyRevisionConflictError,
  requireResourcePolicy,
  writeResourcePolicy,
} from '@/lib/resource-policies/repository'
import type { ConnectorMeta } from '@/connectors/types'

const logger = createLogger('KnowledgeConnectorMemberAccess')

/** Concurrent editors of one group's policy are rare; a handful of retries absorbs them. */
const POLICY_WRITE_ATTEMPTS = 5

const CREDENTIAL_USE_BINDING = {
  resourceType: 'credential_group',
  action: CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION,
} as const satisfies ResourcePolicyBindingFor<'credential_group'>

/** Raised when the group's policy does not let this connector use the credential. */
export class KnowledgeConnectorMemberAccessDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KnowledgeConnectorMemberAccessDeniedError'
  }
}

/** The credential-group slot a members-mode connector crawls with. */
export interface KnowledgeConnectorCredentialBinding extends ResourceOwner {
  credentialGroupId: string
  credentialGroupOptionId: string
  connectorId: string
}

type WorkspaceCredentialBinding = KnowledgeConnectorCredentialBinding & {
  workspaceId: string
  organizationId?: never
}

function policyTarget(
  binding: Pick<WorkspaceCredentialBinding, 'workspaceId' | 'credentialGroupId'>
) {
  return {
    workspaceId: binding.workspaceId,
    resourceType: 'credential_group' as const,
    resourceId: binding.credentialGroupId,
    codec: credentialGroupWorkflowAccessPolicyCodec,
  }
}

function withoutConnector(
  access: readonly CredentialGroupKnowledgeConnectorAccess[],
  connectorId: string
): CredentialGroupKnowledgeConnectorAccess[] {
  return access.map((entry) => ({
    credentialGroupOptionId: entry.credentialGroupOptionId,
    connectorIds: entry.connectorIds.filter((id) => id !== connectorId),
  }))
}

function withConnector(
  access: readonly CredentialGroupKnowledgeConnectorAccess[],
  binding: Pick<KnowledgeConnectorCredentialBinding, 'credentialGroupOptionId' | 'connectorId'>
): CredentialGroupKnowledgeConnectorAccess[] {
  const next = withoutConnector(access, binding.connectorId)
  const option = next.find(
    (entry) => entry.credentialGroupOptionId === binding.credentialGroupOptionId
  )
  if (option) {
    if (option.connectorIds.length >= CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_LIMIT) {
      throw new OrchestrationError(
        'validation',
        `A credential option can back at most ${CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_LIMIT} knowledge connectors`
      )
    }
    option.connectorIds.push(binding.connectorId)
    return next
  }
  return [
    ...next,
    {
      credentialGroupOptionId: binding.credentialGroupOptionId,
      connectorIds: [binding.connectorId],
    },
  ]
}

function sameAccess(
  left: readonly CredentialGroupKnowledgeConnectorAccess[],
  right: readonly CredentialGroupKnowledgeConnectorAccess[]
): boolean {
  const normalise = (access: readonly CredentialGroupKnowledgeConnectorAccess[]) =>
    JSON.stringify(
      access
        .filter((entry) => entry.connectorIds.length > 0)
        .map((entry) => [entry.credentialGroupOptionId, [...entry.connectorIds].sort()])
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    )
  return normalise(left) === normalise(right)
}

/**
 * Rewrites the group's knowledge connector statements through the policy's
 * revision CAS. A concurrent edit (an admin changing workflow access, another
 * connector being bound) loses the race, and the rewrite is recomputed from the
 * fresh document rather than retried blindly, so nobody's statement is lost.
 */
async function rewriteKnowledgeConnectorAccess(input: {
  binding: Pick<WorkspaceCredentialBinding, 'workspaceId' | 'credentialGroupId'>
  actorUserId: string
  change: 'granted' | 'revoked'
  connectorId: string
  credentialGroupOptionId?: string
  mutate: (
    access: readonly CredentialGroupKnowledgeConnectorAccess[]
  ) => CredentialGroupKnowledgeConnectorAccess[]
}): Promise<void> {
  const target = policyTarget(input.binding)
  for (let attempt = 1; attempt <= POLICY_WRITE_ATTEMPTS; attempt += 1) {
    const existing = await requireResourcePolicy(target)
    const current = decodeCredentialGroupKnowledgeConnectorAccess(
      existing.document,
      input.binding.credentialGroupId
    )
    const next = input.mutate(current)
    if (sameAccess(current, next)) return

    const document = compileCredentialGroupWorkflowAccessPolicy({
      credentialGroupId: input.binding.credentialGroupId,
      allowedWorkflowIds: decodeCredentialGroupWorkflowAccessPolicy(
        existing.document,
        input.binding.credentialGroupId
      ),
      knowledgeConnectorAccess: next,
    })
    try {
      const written = await writeResourcePolicy({
        ...target,
        expectedRevision: existing.revision,
        actorUserId: input.actorUserId,
        document,
      })
      recordAudit({
        workspaceId: input.binding.workspaceId,
        actorId: input.actorUserId,
        action: AuditAction.CREDENTIAL_GROUP_UPDATED,
        resourceType: AuditResourceType.CREDENTIAL_GROUP,
        resourceId: input.binding.credentialGroupId,
        description:
          input.change === 'granted'
            ? 'Granted a knowledge connector access to Credential Group credentials'
            : 'Revoked a knowledge connector’s access to Credential Group credentials',
        metadata: {
          revision: written.revision,
          change: input.change,
          connectorId: input.connectorId,
          ...(input.credentialGroupOptionId
            ? { credentialGroupOptionId: input.credentialGroupOptionId }
            : {}),
        },
      })
      return
    } catch (error) {
      if (!(error instanceof ResourcePolicyRevisionConflictError)) throw error
      logger.info('Credential Group policy changed while binding a knowledge connector; retrying', {
        credentialGroupId: input.binding.credentialGroupId,
        connectorId: input.connectorId,
        attempt,
      })
    }
  }
  throw new OrchestrationError(
    'conflict',
    'Credential Group access is being edited by someone else. Try again.'
  )
}

/**
 * Lets the connector use credentials collected under one option. Moving a
 * connector between options replaces its previous binding, since a connector
 * crawls with exactly one credential slot.
 */
export async function grantKnowledgeConnectorCredentialAccess(
  binding: WorkspaceCredentialBinding,
  actorUserId: string
): Promise<void> {
  await rewriteKnowledgeConnectorAccess({
    binding,
    actorUserId,
    change: 'granted',
    connectorId: binding.connectorId,
    credentialGroupOptionId: binding.credentialGroupOptionId,
    mutate: (access) => withConnector(access, binding),
  })
}

/**
 * Removes the connector from every option it was bound to. A group whose policy
 * is already gone (the group was deleted, which cascades the policy) has nothing
 * left to revoke.
 */
export async function revokeKnowledgeConnectorCredentialAccess(
  binding: Pick<WorkspaceCredentialBinding, 'workspaceId' | 'credentialGroupId' | 'connectorId'>,
  actorUserId: string
): Promise<void> {
  try {
    await rewriteKnowledgeConnectorAccess({
      binding,
      actorUserId,
      change: 'revoked',
      connectorId: binding.connectorId,
      mutate: (access) => withoutConnector(access, binding.connectorId),
    })
  } catch (error) {
    if (error instanceof ResourcePolicyNotFoundError) return
    throw error
  }
}

/** Requires the current scope's canonical connector and option authorization before token use. */
export async function assertKnowledgeConnectorCredentialAccess(
  binding: KnowledgeConnectorCredentialBinding
): Promise<void> {
  const scope = resourceScopeFromOwner(binding)
  if (scope.kind === 'organization') {
    const [connector] = await db
      .select({ id: knowledgeConnector.id })
      .from(knowledgeConnector)
      .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
      .innerJoin(credentialGroup, eq(credentialGroup.id, knowledgeConnector.credentialGroupId))
      .where(
        and(
          eq(knowledgeConnector.id, binding.connectorId),
          eq(knowledgeConnector.accessMode, 'members'),
          inArray(knowledgeConnector.status, MEMBER_LOCKABLE_CONNECTOR_STATUSES),
          ne(knowledgeConnector.memberSyncStatus, 'disabled'),
          eq(knowledgeConnector.credentialGroupId, binding.credentialGroupId),
          eq(knowledgeConnector.credentialGroupOptionId, binding.credentialGroupOptionId),
          resourceScopeCondition(knowledgeBase, scope),
          resourceScopeCondition(credentialGroup, scope),
          isNull(knowledgeBase.deletedAt),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt)
        )
      )
      .limit(1)
    if (!connector) {
      throw new KnowledgeConnectorMemberAccessDeniedError(
        'Credential Group is not bound to this organization connector'
      )
    }
    return
  }
  const policy = await requireResourcePolicy(
    policyTarget({ ...binding, workspaceId: scope.workspaceId })
  ).catch((error: unknown) => {
    if (error instanceof ResourcePolicyNotFoundError) {
      throw new KnowledgeConnectorMemberAccessDeniedError(
        'Credential Group no longer has an access policy'
      )
    }
    throw error
  })
  const decision = evaluateCredentialGroupKnowledgeConnectorAccess({
    document: policy.document,
    credentialGroupId: binding.credentialGroupId,
    connectorId: binding.connectorId,
    credentialGroupOptionId: binding.credentialGroupOptionId,
    resourcePolicy: CREDENTIAL_USE_BINDING,
  })
  if (decision.decision !== 'allow') {
    throw new KnowledgeConnectorMemberAccessDeniedError(
      'Credential Group policy does not grant this knowledge connector access to the credential option'
    )
  }
}

export interface MintKnowledgeConnectorMemberTokenInput extends ResourceOwner {
  connectorId: string
  credentialId: string
  expectedProviderId: string
  requiredScopes: string[]
  /** The sync run the access is attributed to in the audit trail. */
  runId: string
}

/**
 * Resolves a member's managed token for a crawl. Not a workspace use case: the
 * sync job has no principal, so the group's own policy is the whole
 * authorization — the connector must be named under the credential's option.
 * Every mint is audited against the credential, attributed to the run.
 */
export async function mintKnowledgeConnectorMemberToken(
  input: MintKnowledgeConnectorMemberTokenInput
): Promise<ResolvedManagedOAuthToken> {
  const binding = await loadManagedCredentialGroupBinding(input.credentialId)
  if (
    !binding ||
    !sameResourceScope(resourceScopeFromOwner(binding), resourceScopeFromOwner(input))
  ) {
    throw new KnowledgeConnectorMemberAccessDeniedError(
      'Managed credential is not enrolled in a Credential Group in this scope'
    )
  }
  if (!isManagedCredentialGroupBindingLive(binding)) {
    throw new KnowledgeConnectorMemberAccessDeniedError(
      'Managed credential is not currently usable: its enrollment, option, or group is not active'
    )
  }
  await assertKnowledgeConnectorCredentialAccess({
    ...resourceScopeFields(resourceScopeFromOwner(binding)),
    credentialGroupId: binding.credentialGroupId,
    credentialGroupOptionId: binding.credentialGroupOptionId,
    connectorId: input.connectorId,
  })
  const token = await resolveManagedOAuthToken({
    credentialId: binding.credentialId,
    ...resourceScopeFields(resourceScopeFromOwner(binding)),
    expectedProviderId: input.expectedProviderId,
    requiredScopes: input.requiredScopes,
  })
  recordAudit({
    workspaceId: binding.workspaceId,
    actorId: null,
    actorName: 'Knowledge connector sync',
    action: AuditAction.CREDENTIAL_ACCESSED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId: binding.credentialId,
    description: `Accessed managed OAuth credential for provider ${input.expectedProviderId} on behalf of a knowledge connector`,
    metadata: {
      organizationId: binding.organizationId,
      provider: input.expectedProviderId,
      credentialType: 'managed_oauth',
      connectorId: input.connectorId,
      credentialGroupId: binding.credentialGroupId,
      credentialGroupOptionId: binding.credentialGroupOptionId,
      runId: input.runId,
    },
  })
  return token
}

/** Reports a provider-rejected token under the same connector grant required to mint it. */
export async function rejectKnowledgeConnectorMemberToken(
  input: MintKnowledgeConnectorMemberTokenInput & {
    rejectedAccessToken: string
  }
): Promise<boolean> {
  const binding = await loadManagedCredentialGroupBinding(input.credentialId)
  if (
    !binding ||
    !sameResourceScope(resourceScopeFromOwner(binding), resourceScopeFromOwner(input))
  ) {
    throw new KnowledgeConnectorMemberAccessDeniedError(
      'Managed credential is not enrolled in a Credential Group in this scope'
    )
  }
  await assertKnowledgeConnectorCredentialAccess({
    ...resourceScopeFields(resourceScopeFromOwner(binding)),
    credentialGroupId: binding.credentialGroupId,
    credentialGroupOptionId: binding.credentialGroupOptionId,
    connectorId: input.connectorId,
  })
  const rejected = await rejectManagedOAuthToken({
    credentialId: binding.credentialId,
    ...resourceScopeFields(resourceScopeFromOwner(binding)),
    expectedProviderId: input.expectedProviderId,
    requiredScopes: input.requiredScopes,
    rejectedAccessToken: input.rejectedAccessToken,
  })
  if (rejected)
    recordAudit({
      workspaceId: binding.workspaceId,
      actorId: null,
      actorName: 'Knowledge connector sync',
      action: AuditAction.CREDENTIAL_UPDATED,
      resourceType: AuditResourceType.CREDENTIAL,
      resourceId: binding.credentialId,
      description: 'Marked provider-rejected managed OAuth credential as needing reauthorization',
      metadata: {
        organizationId: binding.organizationId,
        provider: input.expectedProviderId,
        credentialType: 'managed_oauth',
        connectorId: input.connectorId,
        runId: input.runId,
      },
    })
  return rejected
}

export interface ListKnowledgeConnectorMemberCredentialsInput
  extends KnowledgeConnectorCredentialBinding {
  limit: number
  cursor?: string
}

/**
 * Pages every credential collected under the connector's option, in any state,
 * after proving the connector is granted that option. Membership reconciliation
 * needs the unusable credentials too — they are what gets suspended.
 */
export async function listKnowledgeConnectorMemberCredentials(
  input: ListKnowledgeConnectorMemberCredentialsInput
): Promise<{ credentials: CredentialGroupOptionCredentialReference[]; nextCursor: string | null }> {
  await assertKnowledgeConnectorCredentialAccess(input)
  return listCredentialGroupOptionCredentialReferences({
    ...resourceScopeFields(resourceScopeFromOwner(input)),
    credentialGroupId: input.credentialGroupId,
    credentialGroupOptionId: input.credentialGroupOptionId,
    limit: input.limit,
    cursor: input.cursor,
  })
}

export type KnowledgeConnectorMembersBindingValidation =
  | { ok: true; option: CredentialGroupOptionConfig }
  | { ok: false; message: string }

/** Whether a listing cap is in force. Blank, `0`, and `'0'` all mean unlimited. */
function isCapFieldSet(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'number') return value > 0
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) return false
    const parsed = Number(trimmed)
    return !(Number.isFinite(parsed) && parsed <= 0)
  }
  return true
}

/**
 * The source config with its listing caps set to 0, which every connector
 * reads as unlimited (an absent cap falls back to a connector's default). A
 * cap has no meaning once a connector syncs per member, so the switch clears it rather than refusing a
 * connector the admin can no longer see the field on.
 */
export function stripListingCapFields(
  connectorMeta: Pick<ConnectorMeta, 'permissionScopedListing'>,
  sourceConfig: Record<string, unknown>
): Record<string, unknown> {
  const capFieldIds = connectorMeta.permissionScopedListing?.capFieldIds ?? []
  if (capFieldIds.length === 0) return sourceConfig
  const stripped = { ...sourceConfig }
  for (const fieldId of capFieldIds) stripped[fieldId] = 0
  return stripped
}

/**
 * The message refusing a source config that caps a per-member listing, or
 * null when nothing caps it. A cap would hide part of a member's corpus and
 * suppress removals forever, so it is refused on every members-mode save.
 */
export function findListingCapViolation(
  connectorMeta: Pick<ConnectorMeta, 'permissionScopedListing' | 'configFields'>,
  sourceConfig: Record<string, unknown>
): string | null {
  const capFields = (connectorMeta.permissionScopedListing?.capFieldIds ?? []).filter((fieldId) =>
    isCapFieldSet(sourceConfig[fieldId])
  )
  if (capFields.length === 0) return null
  const titles = capFields.map(
    (fieldId) => connectorMeta.configFields.find((field) => field.id === fieldId)?.title ?? fieldId
  )
  return `${titles.join(', ')} cannot be set when syncing per member: every member's listing must be complete for their access to be tracked`
}

/**
 * Decides whether a connector may crawl per member with one option's
 * credentials. Pure apart from the provider's own scope policy, so a route can
 * refuse a binding before any credential is touched.
 */
export function validateKnowledgeConnectorMembersBinding(input: {
  connectorMeta: Pick<ConnectorMeta, 'name' | 'auth' | 'permissionScopedListing' | 'configFields'>
  group: Pick<CredentialGroupCredentialListContext, 'status' | 'options'>
  credentialGroupOptionId: string
  sourceConfig: Record<string, unknown>
}): KnowledgeConnectorMembersBindingValidation {
  const { connectorMeta, group } = input
  if (!connectorMeta.permissionScopedListing) {
    return {
      ok: false,
      message: `${connectorMeta.name} cannot sync per member: its listing does not reflect who may read each document`,
    }
  }
  if (connectorMeta.auth.mode !== 'oauth') {
    return { ok: false, message: `${connectorMeta.name} does not authenticate with OAuth` }
  }
  if (group.status !== 'active') {
    return { ok: false, message: 'Credential Group is disabled' }
  }
  const option = group.options.find((candidate) => candidate.id === input.credentialGroupOptionId)
  if (!option) {
    return { ok: false, message: 'Credential option was not found in this Credential Group' }
  }
  if (option.status !== 'active') {
    return { ok: false, message: 'Credential option is disabled' }
  }
  if (
    !isCredentialGroupProvider(option.provider) ||
    getCredentialGroupProviderId(option.provider) !== connectorMeta.auth.provider
  ) {
    return {
      ok: false,
      message: `Credential option collects ${option.provider} accounts, but ${connectorMeta.name} needs ${connectorMeta.auth.provider}`,
    }
  }
  const adapter = getCredentialGroupProviderAdapter(option.provider)
  if (!adapter.hasRequiredScopes(option.requiredScopes, connectorMeta.auth.requiredScopes ?? [])) {
    return {
      ok: false,
      message: `Credential option does not request every permission ${connectorMeta.name} needs to read the source`,
    }
  }
  const capViolation = findListingCapViolation(connectorMeta, input.sourceConfig)
  if (capViolation) return { ok: false, message: capViolation }
  return { ok: true, option }
}
