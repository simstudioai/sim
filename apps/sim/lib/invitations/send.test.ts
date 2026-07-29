/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { createPendingInvitation, GrantlessInvitationError } from '@/lib/invitations/send'

describe('createPendingInvitation', () => {
  it.each(['member', 'admin'] as const)(
    'rejects a %s-role organization invitation with no workspace grants',
    async (role) => {
      await expect(
        createPendingInvitation({
          kind: 'organization',
          email: 'invitee@example.com',
          inviterId: 'inviter-1',
          organizationId: 'org-1',
          role,
          grants: [],
        })
      ).rejects.toThrow(GrantlessInvitationError)
    }
  )

  it('rejects a workspace invitation with no workspace grants', async () => {
    await expect(
      createPendingInvitation({
        kind: 'workspace',
        email: 'invitee@example.com',
        inviterId: 'inviter-1',
        organizationId: 'org-1',
        membershipIntent: 'internal',
        role: 'member',
        grants: [],
      })
    ).rejects.toThrow(GrantlessInvitationError)
  })
})
