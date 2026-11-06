import type {
  Principal,
  ResourceDelegatedPrincipal,
  ResourceDelegationScope,
  ResourceFileCopyScope,
} from '@sim/auth/principal'
import { isRecordLike } from '@sim/utils/object'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export interface ResourceDelegationPolicy {
  audience: string
  services: readonly ResourceDelegatedPrincipal['serviceId'][]
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
  if (scope.kind === 'file_collection_observation') {
    return (
      scope.entityType === 'project' &&
      isIdentity(scope.entityId) &&
      Object.keys(scope).length === 3 &&
      Object.keys(scope).every((key) => ['kind', 'entityType', 'entityId'].includes(key))
    )
  }
  return (
    scope.kind === 'entity' &&
    (scope.entityType === 'workspace' ||
      scope.entityType === 'project' ||
      scope.entityType === 'organization' ||
      scope.entityType === 'user') &&
    isIdentity(scope.entityId) &&
    (scope.fileId === undefined || isIdentity(scope.fileId)) &&
    Object.keys(scope).every((key) => ['kind', 'entityType', 'entityId', 'fileId'].includes(key))
  )
}

function isValidInvocation(principal: ResourceDelegatedPrincipal): boolean {
  const invocation = principal.invocation
  if (!isRecordLike(invocation) || Object.keys(invocation).length !== 2) return false
  if (principal.serviceId === 'copilot') {
    return (
      principal.scope.kind !== 'file_collection_observation' &&
      ((invocation.kind === 'chat' && isIdentity(invocation.chatId)) ||
        (invocation.kind === 'workspace' && isIdentity(invocation.workspaceId)))
    )
  }
  return (
    principal.serviceId === 'realtime' &&
    invocation.kind === 'realtime' &&
    isIdentity(invocation.connectionId) &&
    ((principal.scope.kind === 'entity' && isIdentity(principal.scope.fileId)) ||
      principal.scope.kind === 'file_collection_observation')
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
      granted.entityType === required.entityType &&
      granted.entityId === required.entityId
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
    granted.entityType === required.entityType &&
    granted.entityId === required.entityId &&
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
    principal.kind !== 'resource_delegated' ||
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
    !isValidScope(principal.scope) ||
    !isValidInvocation(principal) ||
    !matchesScope(principal.scope, policy.scope)
  ) {
    throw new OrchestrationError('forbidden', 'Resource delegation is no longer valid')
  }
  return principal.subjectUserId
}
