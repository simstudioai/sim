/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  AccountDeletionBlockedError,
  type AccountDeletionFacts,
  classifyAccountDeletion,
  extractProfilePictureKey,
  type WorkspaceCompany,
  type WorkspaceRow,
} from '@/lib/users/account-deletion'

function workspace(overrides: Partial<WorkspaceRow> = {}): WorkspaceRow {
  return { id: 'ws-1', name: 'My workspace', organizationId: null, ...overrides }
}

function company(overrides: Partial<WorkspaceCompany> = {}): WorkspaceCompany {
  return { hasOtherMembers: false, isMember: true, hasAdminSuccessor: false, ...overrides }
}

function facts(overrides: Partial<AccountDeletionFacts> = {}): AccountDeletionFacts {
  return {
    workspaces: [],
    company: new Map(),
    organizationNames: [],
    paidOrganizationName: null,
    personalPlan: null,
    hasDataDrains: false,
    ...overrides,
  }
}

function codes(plan: { blockers: { code: string }[] }): string[] {
  return plan.blockers.map((blocker) => blocker.code)
}

describe('classifyAccountDeletion', () => {
  it('deletes a solo personal workspace with no blockers — the ordinary individual account', () => {
    const ws = workspace()
    const plan = classifyAccountDeletion(
      facts({ workspaces: [ws], company: new Map([[ws.id, company()]]) })
    )

    expect(plan.blockers).toEqual([])
    expect(plan.workspacesToDelete).toEqual([{ id: ws.id, name: ws.name }])
    expect(plan.workspacesToTransfer).toEqual([])
  })

  it('blocks a workspace that other people are in rather than reassigning it', () => {
    const ws = workspace({ name: 'Shared' })
    const plan = classifyAccountDeletion(
      facts({
        workspaces: [ws],
        company: new Map([[ws.id, company({ hasOtherMembers: true, hasAdminSuccessor: true })]]),
      })
    )

    expect(codes(plan)).toEqual(['shared_workspace'])
    expect(plan.workspacesToDelete).toEqual([])
    expect(plan.workspacesToTransfer).toEqual([])
    expect(plan.blockers[0].message).toContain('Shared')
  })

  it('blocks a workspace the account merely belongs to, where it is not the anchor', () => {
    const ws = workspace()
    const plan = classifyAccountDeletion(
      facts({
        workspaces: [ws],
        company: new Map([[ws.id, company({ hasOtherMembers: true, hasAdminSuccessor: true })]]),
      })
    )

    expect(codes(plan)).toEqual(['shared_workspace'])
  })

  it('transfers a billing anchor the account holds no access to', () => {
    const ws = workspace({ name: 'Anchored', ownerId: 'other-admin' })
    const plan = classifyAccountDeletion(
      facts({
        workspaces: [ws],
        company: new Map([
          [ws.id, company({ hasOtherMembers: true, isMember: false, hasAdminSuccessor: true })],
        ]),
      })
    )

    expect(plan.blockers).toEqual([])
    expect(plan.workspacesToTransfer).toEqual([{ id: ws.id, name: 'Anchored' }])
  })

  it('blocks an anchor nobody can inherit, rather than orphaning the billing reference', () => {
    const ws = workspace()
    const plan = classifyAccountDeletion(
      facts({
        workspaces: [ws],
        company: new Map([[ws.id, company({ hasOtherMembers: true, isMember: false })]]),
      })
    )

    expect(codes(plan)).toEqual(['shared_workspace'])
  })

  it('blocks a solo workspace that belongs to an organization, whose ledger is shared', () => {
    const ws = workspace({ organizationId: 'org-1', name: 'Org space' })
    const plan = classifyAccountDeletion(
      facts({ workspaces: [ws], company: new Map([[ws.id, company()]]) })
    )

    expect(codes(plan)).toEqual(['organization_workspace'])
    expect(plan.workspacesToDelete).toEqual([])
  })

  it('reports paid organization ownership instead of plain membership', () => {
    const plan = classifyAccountDeletion(
      facts({
        paidOrganizationName: 'Acme',
        organizationNames: ['Acme'],
      })
    )

    expect(codes(plan)).toEqual(['paid_organization_owner'])
    expect(plan.blockers[0].message).toContain('Acme')
  })

  it('asks a plain organization member to leave first, so their seat is released', () => {
    const plan = classifyAccountDeletion(facts({ organizationNames: ['Acme'] }))

    expect(codes(plan)).toEqual(['organization_member'])
  })

  it('collects every independent blocker in one pass', () => {
    const ws = workspace({ name: 'Shared' })
    const plan = classifyAccountDeletion(
      facts({
        workspaces: [ws],
        company: new Map([[ws.id, company({ hasOtherMembers: true })]]),
        organizationNames: ['Acme'],
        personalPlan: 'pro',
        hasDataDrains: true,
      })
    )

    expect(codes(plan)).toEqual([
      'organization_member',
      'active_subscription',
      'data_drain_owner',
      'shared_workspace',
    ])
  })

  it('names up to three workspaces and summarizes the rest', () => {
    const workspaces = ['One', 'Two', 'Three', 'Four'].map((name, index) =>
      workspace({ id: `ws-${index}`, name })
    )
    const plan = classifyAccountDeletion(
      facts({
        workspaces,
        company: new Map(
          workspaces.map((ws) => [ws.id, company({ hasOtherMembers: true })] as const)
        ),
      })
    )

    expect(plan.blockers[0].message).toContain('"One", "Two", "Three" and 1 more')
  })
})

describe('AccountDeletionBlockedError', () => {
  it('classifies itself as a conflict so the route renders a refusal as 409, not 500', () => {
    const error = new AccountDeletionBlockedError([
      { code: 'active_subscription', message: 'Your pro plan is still active.' },
    ])

    expect(error.code).toBe('conflict')
    expect(error.message).toBe('Your pro plan is still active.')
  })

  it('still carries a message when constructed with no blockers', () => {
    expect(new AccountDeletionBlockedError([]).message).toMatch(/cannot be deleted/i)
  })
})

describe('extractProfilePictureKey', () => {
  it('extracts the storage key from an uploaded avatar path', () => {
    expect(extractProfilePictureKey('/api/files/serve/profile-pictures%2Fu1%2Favatar.png')).toBe(
      'profile-pictures/u1/avatar.png'
    )
  })

  it('strips the storage-provider segment', () => {
    expect(extractProfilePictureKey('/api/files/serve/s3/profile-pictures%2Fu1%2Fa.png')).toBe(
      'profile-pictures/u1/a.png'
    )
  })

  it('ignores an external avatar, which is the provider’s object and not ours to delete', () => {
    expect(extractProfilePictureKey('https://lh3.googleusercontent.com/a/abc123')).toBeNull()
  })

  it('ignores a served key outside the profile-pictures prefix', () => {
    expect(extractProfilePictureKey('/api/files/serve/workspace%2Fw1%2Freport.pdf')).toBeNull()
  })

  it('handles an account with no picture', () => {
    expect(extractProfilePictureKey(null)).toBeNull()
    expect(extractProfilePictureKey('')).toBeNull()
  })
})
