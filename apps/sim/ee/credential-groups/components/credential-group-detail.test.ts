/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { CredentialGroupEnrollmentDetail } from '@/lib/api/contracts/credential-groups'
import { getEnrollmentStatus } from '@/ee/credential-groups/components/credential-group-detail'

const ENROLLMENT: CredentialGroupEnrollmentDetail = {
  id: 'enrollment-1',
  credentialGroupId: 'group-1',
  email: 'person@example.com',
  status: 'in_progress',
  expiresAt: '2026-08-13T00:00:00.000Z',
  invitedAt: '2026-08-12T00:00:00.000Z',
  sentAt: '2026-08-12T00:00:00.000Z',
  completedAt: null,
  revokedAt: null,
  expired: true,
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
  connections: [{ provider: 'gmail', status: 'needs_reauth', count: 1 }],
}

describe('Credential Group enrollment status', () => {
  it('keeps expired incomplete invitations ahead of credential reauthorization', () => {
    expect(getEnrollmentStatus(ENROLLMENT, ['gmail'])).toEqual({
      label: 'Expired',
      invalid: true,
    })
  })

  it('shows reauthorization for completed enrollments after their invitation expires', () => {
    expect(getEnrollmentStatus({ ...ENROLLMENT, status: 'completed' }, ['gmail'])).toEqual({
      label: 'Reconnect needed',
      invalid: false,
    })
  })
})
