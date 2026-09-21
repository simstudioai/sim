import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type {
  AllMembersConflict,
  ScopeConflict,
} from '@/lib/permission-groups/application/group-membership'
import {
  PERMISSION_GROUP_CONSTRAINTS,
  PERMISSION_GROUP_MEMBER_CONSTRAINTS,
} from '@/lib/permission-groups/constraints'

export class PermissionGroupOrganizationNotFoundError extends OrchestrationError {
  constructor() {
    super('not_found', 'Organization not found')
  }
}

export class PermissionGroupBusyError extends Error {
  constructor() {
    super('This group is being updated by another request. Please try again.')
  }
}

export function rethrowPermissionGroupWriteError(error: unknown): never {
  if (getPostgresErrorCode(error) === '55P03') throw new PermissionGroupBusyError()
  if (getPostgresErrorCode(error) === '23505') {
    const constraint = getPostgresConstraintName(error)
    if (constraint === PERMISSION_GROUP_CONSTRAINTS.organizationName)
      throw new OrchestrationError('conflict', 'A permission group with this name already exists')
    if (constraint === PERMISSION_GROUP_CONSTRAINTS.organizationDefault)
      throw new OrchestrationError(
        'conflict',
        'Another group was concurrently set as the default. Please refresh and try again.'
      )
    if (constraint === PERMISSION_GROUP_MEMBER_CONSTRAINTS.groupUser)
      throw new OrchestrationError('conflict', 'User is already in this permission group')
  }
  throw error
}

/**
 * Human-readable 409 message for a scope/membership conflict, naming the member
 * and the group they already belong to that overlaps the requested workspaces.
 */
export function formatScopeConflictError(conflicts: ScopeConflict[]): string {
  const [first] = conflicts
  if (!first) {
    return 'A member would be governed by two groups for the same workspace. Resolve their group memberships first.'
  }
  const who = first.userName || first.userEmail || 'A member'
  if (conflicts.length === 1) {
    return `${who} is already in the group "${first.conflictingGroupName}", which targets one of these workspaces. Remove them from one group first.`
  }
  const others = conflicts.length - 1
  return `${who} and ${others} other member${others === 1 ? '' : 's'} already belong to groups that target these workspaces (e.g. "${first.conflictingGroupName}"). Resolve their group memberships first.`
}

/**
 * Human-readable 409 message when another group already governs everyone in a
 * workspace this group would also apply to all members of.
 */
export function formatAllMembersConflictError(conflict: AllMembersConflict): string {
  return `The group "${conflict.conflictingGroupName}" already applies to everyone in "${conflict.workspaceName}". Two groups can't both govern all members of the same workspace — add members to one of them, or remove that workspace from one group first.`
}
