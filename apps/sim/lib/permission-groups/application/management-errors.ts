import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  PermissionGroupAllMembersConflictError,
  PermissionGroupNotFoundError,
  PermissionGroupScopeConflictError,
} from '@/lib/permission-groups/application/group-membership'
import {
  formatAllMembersConflictError,
  formatScopeConflictError,
} from '@/lib/permission-groups/application/management-store'
import {
  PERMISSION_GROUP_CONSTRAINTS,
  PERMISSION_GROUP_MEMBER_CONSTRAINTS,
} from '@/lib/permission-groups/constraints'

/** Lock contention remains a retryable 503 on the existing settings HTTP surface. */
export class PermissionGroupContentionError extends OrchestrationError {
  constructor(subject: 'organization' | 'group') {
    super('locked', `This ${subject} is being updated by another request. Please try again.`)
  }
}

/** Classifies database and shared membership errors without hiding infrastructure failures. */
export function classifyPermissionGroupError(error: unknown, operation: string): Error | null {
  if (error instanceof PermissionGroupNotFoundError) {
    return new OrchestrationError('not_found', 'Permission group not found')
  }
  if (error instanceof PermissionGroupScopeConflictError) {
    return new OrchestrationError('conflict', formatScopeConflictError(error.conflicts))
  }
  if (error instanceof PermissionGroupAllMembersConflictError) {
    return new OrchestrationError('conflict', formatAllMembersConflictError(error.conflict))
  }
  if (getPostgresErrorCode(error) === '55P03') {
    return new PermissionGroupContentionError(
      operation === 'permission_groups.create' ? 'organization' : 'group'
    )
  }
  if (getPostgresErrorCode(error) !== '23505') return null
  const constraint = getPostgresConstraintName(error)
  if (constraint === PERMISSION_GROUP_CONSTRAINTS.organizationName) {
    return new OrchestrationError('conflict', 'A permission group with this name already exists')
  }
  if (constraint === PERMISSION_GROUP_CONSTRAINTS.organizationDefault) {
    return new OrchestrationError(
      'conflict',
      'Another group was concurrently set as the default. Please refresh and try again.'
    )
  }
  if (constraint === PERMISSION_GROUP_MEMBER_CONSTRAINTS.groupUser) {
    return new OrchestrationError(
      'conflict',
      operation === 'permission_groups.members.bulk_add'
        ? 'One or more users were concurrently added to this group. Please refresh and try again.'
        : 'User is already in this permission group'
    )
  }
  return null
}
