/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/emails/render', () => ({
  renderCredentialGroupInvitationEmail: vi.fn(),
}))

vi.mock('@/lib/messaging/email/mailer', () => ({ sendEmail: vi.fn() }))

import { listCredentialGroupEnrollments } from '@/lib/credential-groups/enrollments'
import { CREDENTIAL_GROUP_PROVIDER_IDS } from '@/lib/credential-groups/providers'

const MAX_CONNECTION_SUMMARIES = CREDENTIAL_GROUP_PROVIDER_IDS.length * 3

const ENROLLMENT = {
  id: 'enrollment-1',
  credentialGroupId: 'group-1',
  email: 'alex@example.com',
  status: 'completed' as const,
  invitationTokenHash: 'a'.repeat(64),
  invitationExpiresAt: new Date('2026-08-18T12:00:00.000Z'),
  invitedAt: new Date('2026-08-11T12:00:00.000Z'),
  sentAt: new Date('2026-08-11T12:00:01.000Z'),
  completedAt: new Date('2026-08-11T12:05:00.000Z'),
  revokedAt: null,
  lastDeliveryError: null,
  createdBy: 'user-1',
  createdAt: new Date('2026-08-11T12:00:00.000Z'),
  updatedAt: new Date('2026-08-11T12:05:00.000Z'),
}

describe('listCredentialGroupEnrollments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns bounded provider summaries instead of materializing every credential', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ options: [{ id: 'option-1', status: 'active' }] }])
      .mockResolvedValueOnce([{ enrollment: ENROLLMENT }])
      .mockResolvedValueOnce([
        {
          enrollmentId: ENROLLMENT.id,
          providerId: 'google-email',
          status: 'active',
          count: 2,
        },
        {
          enrollmentId: ENROLLMENT.id,
          providerId: 'google-email',
          status: 'needs_reauth',
          count: 1,
        },
      ])

    const result = await listCredentialGroupEnrollments('workspace-1', 'group-1', 50)

    expect(result.enrollments[0]?.connections).toEqual([
      { provider: 'gmail', status: 'active', count: 2 },
      { provider: 'gmail', status: 'needs_reauth', count: 1 },
    ])
    expect(dbChainMockFns.limit).toHaveBeenNthCalledWith(3, MAX_CONNECTION_SUMMARIES + 1)
  })

  it('fails fast when a managed credential uses an unsupported provider', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ options: [{ id: 'option-1', status: 'active' }] }])
      .mockResolvedValueOnce([{ enrollment: ENROLLMENT }])
      .mockResolvedValueOnce([
        {
          enrollmentId: ENROLLMENT.id,
          providerId: 'unexpected-provider',
          status: 'active',
          count: 1,
        },
      ])

    await expect(listCredentialGroupEnrollments('workspace-1', 'group-1', 50)).rejects.toThrow(
      'Unsupported managed credential provider: unexpected-provider'
    )
  })

  it('rejects connection summaries beyond the bounded provider-state cardinality', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ options: [{ id: 'option-1', status: 'active' }] }])
      .mockResolvedValueOnce([{ enrollment: ENROLLMENT }])
      .mockResolvedValueOnce(
        Array.from({ length: MAX_CONNECTION_SUMMARIES + 1 }, (_, index) => ({
          enrollmentId: ENROLLMENT.id,
          providerId: 'google-email',
          status: 'active',
          count: index + 1,
        }))
      )

    await expect(listCredentialGroupEnrollments('workspace-1', 'group-1', 50)).rejects.toThrow(
      'Managed credential connection summaries exceed the supported provider states'
    )
  })

  it('rejects an unbounded enrollment page request', async () => {
    await expect(listCredentialGroupEnrollments('workspace-1', 'group-1', 101)).rejects.toThrow(
      'Credential group enrollment limit must be between 1 and 100'
    )
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
