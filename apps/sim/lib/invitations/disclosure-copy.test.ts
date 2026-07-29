/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildMembershipNotice,
  buildWorkspaceMigrationNotice,
} from '@/lib/invitations/disclosure-copy'

const preview = (over: Partial<Parameters<typeof buildMembershipNotice>[0]['joinPreview']> = {}) =>
  ({
    willJoinOrganization: true,
    organizationName: 'Acme',
    workspacesToMove: [],
    workspaceIdsToMove: [],
    ...over,
  }) as NonNullable<Parameters<typeof buildMembershipNotice>[0]['joinPreview']>

describe('buildMembershipNotice', () => {
  it('discloses the seat when acceptance will join the organization', () => {
    const notice = buildMembershipNotice({
      joinPreview: preview(),
      membershipIntent: 'internal',
      isOrganizationAdminRole: false,
      organizationLabel: 'Acme',
      isOrganizationScoped: true,
    })

    expect(notice).toContain('as a member')
    expect(notice).toContain('uses one of their seats')
  })

  it('says admin when the invited organization role is an admin role', () => {
    expect(
      buildMembershipNotice({
        joinPreview: preview(),
        membershipIntent: 'internal',
        isOrganizationAdminRole: true,
        organizationLabel: 'Acme',
        isOrganizationScoped: true,
      })
    ).toContain('as an admin')
  })

  /**
   * The reason this is keyed on the preview: acceptance downgrades an internal
   * invite to external when the invitee already belongs to another organization.
   * Promising a seat there would be a disclosure/outcome mismatch.
   */
  it('discloses external when acceptance will NOT join, despite an internal invite', () => {
    const notice = buildMembershipNotice({
      joinPreview: preview({ willJoinOrganization: false }),
      membershipIntent: 'internal',
      isOrganizationAdminRole: false,
      organizationLabel: 'Acme',
      isOrganizationScoped: true,
    })

    expect(notice).toContain('external collaborator')
    expect(notice).toContain("don't take one of their seats")
    expect(notice).not.toContain('uses one of their seats')
  })

  it('falls back to the sent intent when no preview could be computed', () => {
    expect(
      buildMembershipNotice({
        joinPreview: null,
        membershipIntent: 'internal',
        isOrganizationAdminRole: false,
        organizationLabel: 'Acme',
        isOrganizationScoped: true,
      })
    ).toContain('uses one of their seats')

    expect(
      buildMembershipNotice({
        joinPreview: null,
        membershipIntent: 'external',
        isOrganizationAdminRole: false,
        organizationLabel: 'Acme',
        isOrganizationScoped: true,
      })
    ).toContain('external collaborator')
  })

  it('says nothing for an invitation with no organization standing', () => {
    expect(
      buildMembershipNotice({
        joinPreview: null,
        membershipIntent: 'internal',
        isOrganizationAdminRole: false,
        organizationLabel: 'the organization',
        isOrganizationScoped: false,
      })
    ).toBe('')
  })
})

describe('buildWorkspaceMigrationNotice', () => {
  it('names the workspaces that will move', () => {
    const notice = buildWorkspaceMigrationNotice({
      joinPreview: preview({ workspacesToMove: ['Alpha', 'Beta'] }),
      joinPreviewUnavailable: false,
      membershipIntent: 'internal',
      organizationLabel: 'Acme',
    })

    expect(notice).toContain('"Alpha", "Beta"')
    expect(notice).toContain('into Acme')
  })

  it('collapses a long list into an overflow tail', () => {
    expect(
      buildWorkspaceMigrationNotice({
        joinPreview: preview({ workspacesToMove: ['A', 'B', 'C', 'D'] }),
        joinPreviewUnavailable: false,
        membershipIntent: 'internal',
        organizationLabel: 'Acme',
      })
    ).toContain('and 1 more')
  })

  it('says nothing when nothing will move', () => {
    expect(
      buildWorkspaceMigrationNotice({
        joinPreview: preview({ workspacesToMove: [] }),
        joinPreviewUnavailable: false,
        membershipIntent: 'internal',
        organizationLabel: 'Acme',
      })
    ).toBe('')
  })

  /** A missing preview must never read as "nothing moves". */
  it('falls back to a generic warning when the preview is unavailable', () => {
    expect(
      buildWorkspaceMigrationNotice({
        joinPreview: null,
        joinPreviewUnavailable: true,
        membershipIntent: 'internal',
        organizationLabel: 'Acme',
      })
    ).toContain('If you own personal workspaces')
  })

  it('warns about nothing for an external invite, which moves nothing', () => {
    expect(
      buildWorkspaceMigrationNotice({
        joinPreview: null,
        joinPreviewUnavailable: true,
        membershipIntent: 'external',
        organizationLabel: 'Acme',
      })
    ).toBe('')
  })
})
