export interface ScopedWorkspaceGrant {
  workspaceId: string
  organizationId: string | null
}

export interface InvitationGrantPartition<T extends ScopedWorkspaceGrant> {
  movedGrant: T | null
  keepOnOriginal: T[]
  redistribute: T[]
  cancelOriginal: boolean
}

/**
 * Partitions a multi-workspace invitation while keeping the original token on
 * the moved workspace. An existing destination invitation takes precedence:
 * the moved grant merges into it and the original invitation is cancelled
 * after every remaining grant is redistributed.
 */
export function partitionInvitationGrantsForWorkspaceMove<T extends ScopedWorkspaceGrant>(params: {
  grants: T[]
  movedWorkspaceId: string
  destinationOrganizationId: string
  mergesIntoExistingDestination: boolean
}): InvitationGrantPartition<T> {
  const movedGrant =
    params.grants.find((grant) => grant.workspaceId === params.movedWorkspaceId) ?? null
  const remaining = params.grants.filter((grant) => grant.workspaceId !== params.movedWorkspaceId)

  if (params.mergesIntoExistingDestination) {
    return {
      movedGrant,
      keepOnOriginal: [],
      redistribute: remaining,
      cancelOriginal: true,
    }
  }

  return {
    movedGrant,
    keepOnOriginal: remaining.filter(
      (grant) => grant.organizationId === params.destinationOrganizationId
    ),
    redistribute: remaining.filter(
      (grant) => grant.organizationId !== params.destinationOrganizationId
    ),
    cancelOriginal: false,
  }
}

export function mergeInvitationMembershipIntent(
  current: 'internal' | 'external',
  incoming: 'internal' | 'external'
): 'internal' | 'external' {
  return current === 'internal' || incoming === 'internal' ? 'internal' : 'external'
}

export function mergeInvitationRole(current: string, incoming: string): 'admin' | 'member' {
  return current === 'admin' || incoming === 'admin' ? 'admin' : 'member'
}
