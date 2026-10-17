import type {
  Principal,
  ResourceDelegationScope,
  ResourceFileCopyScope,
  ResourceOperationPrincipal,
} from '@sim/auth/principal'
import { hasResourceOperationGrant } from '@sim/auth/principal'
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

function isCopyOwner(value: unknown): boolean {
  return (
    isRecordLike(value) &&
    (value.entityType === 'workspace' || value.entityType === 'project') &&
    isIdentity(value.entityId) &&
    Object.keys(value).length === 2 &&
    Object.keys(value).every((key) => key === 'entityType' || key === 'entityId')
  )
}

function isSelectionIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 1_000 &&
    Array.from(value).every(isIdentity) &&
    new Set(value).size === value.length
  )
}

/** Validates the paired scope shared by delegation admission and the copy application boundary. */
export function isResourceFileCopyScope(scope: unknown): scope is ResourceFileCopyScope {
  if (!isRecordLike(scope) || scope.kind !== 'file_copy') return false
  const { source, destination } = scope
  return (
    Object.keys(scope).length === 3 &&
    Object.keys(scope).every((key) => ['kind', 'source', 'destination'].includes(key)) &&
    isRecordLike(source) &&
    Object.keys(source).length === 3 &&
    Object.keys(source).every((key) => ['owner', 'fileIds', 'folderIds'].includes(key)) &&
    isCopyOwner(source.owner) &&
    isSelectionIds(source.fileIds) &&
    isSelectionIds(source.folderIds) &&
    source.fileIds.length + source.folderIds.length > 0 &&
    isRecordLike(destination) &&
    Object.keys(destination).length === 2 &&
    Object.keys(destination).every((key) => key === 'owner' || key === 'folderId') &&
    isCopyOwner(destination.owner) &&
    (destination.folderId === null || isIdentity(destination.folderId))
  )
}

function isValidScope(scope: unknown): scope is ResourceDelegationScope {
  if (!isRecordLike(scope)) return false
  if (scope.kind === 'project_discovery') return Object.keys(scope).length === 1
  if (scope.kind === 'file_copy') return isResourceFileCopyScope(scope)
  if (
    !isRecordLike(scope.owner) ||
    Object.keys(scope.owner).length !== 2 ||
    !Object.keys(scope.owner).every((key) => key === 'entityType' || key === 'entityId') ||
    !isIdentity(scope.owner.entityId)
  )
    return false
  if (scope.kind === 'file_collection_observation') {
    return (
      scope.owner.entityType === 'project' &&
      Object.keys(scope).length === 2 &&
      Object.keys(scope).every((key) => key === 'kind' || key === 'owner')
    )
  }
  return (
    scope.kind === 'entity' &&
    ['workspace', 'project', 'organization', 'user'].includes(String(scope.owner.entityType)) &&
    (scope.fileId === undefined || isIdentity(scope.fileId)) &&
    Object.keys(scope).every((key) => ['kind', 'owner', 'fileId'].includes(key))
  )
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
    !isValidScope(policy.scope)
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
    !isValidScope(principal.grant) ||
    !isValidInvocation(principal) ||
    !matchesScope(principal.grant, policy.scope)
  ) {
    throw new OrchestrationError('forbidden', 'Resource delegation is no longer valid')
  }
  return principal.subjectUserId
}
