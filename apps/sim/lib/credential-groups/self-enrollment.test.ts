/** @vitest-environment node */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { issue, authenticate, bind } = vi.hoisted(() => ({
  issue: vi.fn(),
  authenticate: vi.fn(),
  bind: vi.fn(),
}))
vi.mock('@/lib/credential-groups/enrollments', () => ({
  createCredentialGroupSelfEnrollmentLink: issue,
  authenticatePublicCredentialGroupEnrollment: authenticate,
  bindCredentialGroupEnrollmentUser: bind,
  CredentialGroupEnrollmentError: class extends Error {
    constructor(
      message: string,
      public status: number
    ) {
      super(message)
    }
  },
}))

import { CredentialGroupEnrollmentError } from '@/lib/credential-groups/enrollments'
import { createViewerCredentialGroupEnrollment } from '@/lib/credential-groups/self-enrollment'

const input = { userId: 'viewer', workspaceId: 'workspace', credentialGroupId: 'group' }

describe('viewer account enrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    authenticate.mockResolvedValue({ enrollmentId: 'enrollment' })
    bind.mockResolvedValue(undefined)
  })

  it('uses the verified account email rather than a caller-supplied address', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ email: ' Viewer@Example.com ', emailVerified: true }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    issue.mockResolvedValue({
      enrollment: { id: 'enrollment' },
      invitationLink: 'https://sim.test/enroll/token',
    })
    await createViewerCredentialGroupEnrollment(input)
    expect(issue).toHaveBeenCalledWith(
      { kind: 'workspace', workspaceId: 'workspace' },
      'group',
      'viewer@example.com'
    )
  })

  it('requires a verified current user', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { email: 'viewer@example.com', emailVerified: false },
    ])
    await expect(createViewerCredentialGroupEnrollment(input)).rejects.toThrow('Verify your email')
    expect(issue).not.toHaveBeenCalled()
  })

  it('refuses a revoked enrollment without minting a link', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ email: 'viewer@example.com', emailVerified: true }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: 'revoked' }])
    await expect(createViewerCredentialGroupEnrollment(input)).rejects.toThrow(
      'removed your access'
    )
    expect(issue).not.toHaveBeenCalled()
  })

  it('preserves a revocation applied during the invitation transaction', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ email: 'viewer@example.com', emailVerified: true }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: 'revoked' }])
    issue.mockRejectedValue(new CredentialGroupEnrollmentError('Revoked', 409))
    await expect(createViewerCredentialGroupEnrollment(input)).rejects.toThrow(
      'removed your access'
    )
  })
})
