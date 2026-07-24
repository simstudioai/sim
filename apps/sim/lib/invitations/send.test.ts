/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { createPendingInvitation, GrantlessMemberInvitationError } from '@/lib/invitations/send'

describe('createPendingInvitation', () => {
  it('rejects a member-role organization invitation with no workspace grants', async () => {
    await expect(
      createPendingInvitation({
        kind: 'organization',
        email: 'invitee@example.com',
        inviterId: 'inviter-1',
        organizationId: 'org-1',
        role: 'member',
        grants: [],
      })
    ).rejects.toThrow(GrantlessMemberInvitationError)
  })
})
