import type {
  Principal,
  ResourceDelegationScope,
  ResourceOperationPrincipal,
} from '@sim/auth/principal'
import { hasResourceOperationGrant, isResourceDelegationScope } from '@sim/auth/principal'
import { isRecordLike } from '@sim/utils/object'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export interface ResourceDelegationPolicy {
  audience: string
  services: readonly ResourceOperationPrincipal['serviceId'][]
  scope: ResourceDelegationScope
  maxTtlMs: number
}

function isIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}

function isValidInvocation(principal: ResourceOperationPrincipal): boolean {
  const invocation = principal.invocation
  if (!isRecordLike(invocation) || Object.keys(invocation).length !== 2) return false
  if (principal.serviceId === 'copilot') {
    return (
      principal.grant.kind !== 'file_collection_observation' &&
      ((invocation.kind === 'chat' && isIdentity(invocation.chatId)) ||
        (invocation.kind === 'workspace' && isIdentity(invocation.workspaceId)))
    )
  }
  return (
    principal.serviceId === 'realtime' &&
    invocation.kind === 'realtime' &&
    isIdentity(invocation.connectionId) &&
    ((principal.grant.kind === 'entity' && isIdentity(principal.grant.fileId)) ||
      principal.grant.kind === 'file_collection_observation')
  )
}

function matchesScope(
  granted: ResourceDelegationScope,
  required: ResourceDelegationScope
): boolean {
  if (granted.kind !== required.kind) return false
  if (granted.kind === 'project_discovery') return true
  if (granted.kind === 'file_collection_observation') {
    return (
      required.kind === 'file_collection_observation' &&
      granted.owner.entityType === required.owner.entityType &&
      granted.owner.entityId === required.owner.entityId
    )
  }
  if (granted.kind === 'file_copy') {
    if (required.kind !== 'file_copy') return false
    const requestedFiles = new Set(required.source.fileIds)
    const requestedFolders = new Set(required.source.folderIds)
    return (
      granted.source.owner.entityType === required.source.owner.entityType &&
      granted.source.owner.entityId === required.source.owner.entityId &&
      granted.destination.owner.entityType === required.destination.owner.entityType &&
      granted.destination.owner.entityId === required.destination.owner.entityId &&
      granted.destination.folderId === required.destination.folderId &&
      granted.source.fileIds.length === requestedFiles.size &&
      granted.source.fileIds.every((id) => requestedFiles.has(id)) &&
      granted.source.folderIds.length === requestedFolders.size &&
      granted.source.folderIds.every((id) => requestedFolders.has(id))
    )
  }
  return (
    required.kind === 'entity' &&
    granted.owner.entityType === required.owner.entityType &&
    granted.owner.entityId === required.owner.entityId &&
    (granted.fileId === undefined || granted.fileId === required.fileId)
  )
}

/** Checks delegation bounds; the domain must still authorize the invocation and current user access. */
export function requireResourceDelegation(
  principal: Principal,
  policy: ResourceDelegationPolicy
): string {
  if (
    !isIdentity(policy.audience) ||
    !Number.isSafeInteger(policy.maxTtlMs) ||
    policy.maxTtlMs <= 0 ||
    policy.services.length === 0 ||
    !policy.services.every((service) => service === 'copilot' || service === 'realtime') ||
    !isResourceDelegationScope(policy.scope)
  ) {
    throw new Error('Resource delegation requires a bounded operation policy')
  }

  const now = Date.now()
  if (
    !hasResourceOperationGrant(principal) ||
    ('workspaceId' in principal && principal.workspaceId !== undefined) ||
    ('resourceScope' in principal && principal.resourceScope !== undefined) ||
    !policy.services.includes(principal.serviceId) ||
    principal.audience !== policy.audience ||
    !isIdentity(principal.subjectUserId) ||
    !isIdentity(principal.delegationId) ||
    !(principal.issuedAt instanceof Date) ||
    !(principal.expiresAt instanceof Date) ||
    !Number.isFinite(principal.issuedAt.getTime()) ||
    !Number.isFinite(principal.expiresAt.getTime()) ||
    principal.issuedAt.getTime() > now ||
    principal.expiresAt.getTime() <= now ||
    principal.expiresAt.getTime() - principal.issuedAt.getTime() > policy.maxTtlMs ||
    !isResourceDelegationScope(principal.grant) ||
    !isValidInvocation(principal) ||
    !matchesScope(principal.grant, policy.scope)
  ) {
    throw new OrchestrationError('forbidden', 'Resource delegation is no longer valid')
  }
  return principal.subjectUserId
}
