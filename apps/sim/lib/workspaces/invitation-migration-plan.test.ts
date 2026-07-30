/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  mergeInvitationMembershipIntent,
  mergeInvitationRole,
  partitionInvitationGrantsForWorkspaceMove,
} from '@/lib/workspaces/invitation-migration-plan'

describe('partitionInvitationGrantsForWorkspaceMove', () => {
  const grants = [
    { workspaceId: 'moved', organizationId: null },
    { workspaceId: 'same-destination', organizationId: 'org-new' },
    { workspaceId: 'personal', organizationId: null },
    { workspaceId: 'other-org', organizationId: 'org-other' },
  ]

  it('keeps the original token on grants that resolve to the destination scope', () => {
    const result = partitionInvitationGrantsForWorkspaceMove({
      grants,
      movedWorkspaceId: 'moved',
      destinationOrganizationId: 'org-new',
      mergesIntoExistingDestination: false,
    })

    expect(result.movedGrant?.workspaceId).toBe('moved')
    expect(result.keepOnOriginal.map((grant) => grant.workspaceId)).toEqual(['same-destination'])
    expect(result.redistribute.map((grant) => grant.workspaceId)).toEqual(['personal', 'other-org'])
    expect(result.cancelOriginal).toBe(false)
  })

  it('redistributes all remaining grants when the moved grant merges into an existing invite', () => {
    const result = partitionInvitationGrantsForWorkspaceMove({
      grants,
      movedWorkspaceId: 'moved',
      destinationOrganizationId: 'org-new',
      mergesIntoExistingDestination: true,
    })

    expect(result.keepOnOriginal).toEqual([])
    expect(result.redistribute).toHaveLength(3)
    expect(result.cancelOriginal).toBe(true)
  })

  it('reports a missing moved grant without mutating the remaining set', () => {
    const result = partitionInvitationGrantsForWorkspaceMove({
      grants,
      movedWorkspaceId: 'missing',
      destinationOrganizationId: 'org-new',
      mergesIntoExistingDestination: false,
    })

    expect(result.movedGrant).toBeNull()
    expect(result.keepOnOriginal).toHaveLength(1)
    expect(result.redistribute).toHaveLength(3)
  })
})

describe('merged invitation semantics', () => {
  it('preserves internal membership intent and the strongest role', () => {
    expect(mergeInvitationMembershipIntent('external', 'internal')).toBe('internal')
    expect(mergeInvitationMembershipIntent('internal', 'external')).toBe('internal')
    expect(mergeInvitationMembershipIntent('external', 'external')).toBe('external')
    expect(mergeInvitationRole('member', 'admin')).toBe('admin')
    expect(mergeInvitationRole('member', 'member')).toBe('member')
  })
})
