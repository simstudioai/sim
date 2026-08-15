/**
 * @vitest-environment node
 */
import type { CredentialGroupEnrollmentPrincipal, SessionPrincipal } from '@sim/auth/principal'
import { sha256Hex } from '@sim/security/hash'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  completeEnrollment: vi.fn(),
  getEnrollment: vi.fn(),
  getOAuthContext: vi.fn(),
  startOAuth: vi.fn(),
}))

vi.mock('@/lib/credential-groups/enrollments', () => ({
  completeAuthorizedCredentialGroupEnrollment: mocks.completeEnrollment,
  getAuthorizedCredentialGroupOAuthContext: mocks.getOAuthContext,
  getAuthorizedPublicCredentialGroupEnrollment: mocks.getEnrollment,
}))

vi.mock('@/lib/credential-groups/oauth', () => ({
  completeCredentialGroupOAuth: vi.fn(),
  startCredentialGroupOAuth: mocks.startOAuth,
}))

import {
  readPublicCredentialGroupEnrollment,
  startPublicCredentialGroupOAuth,
} from '@/lib/credential-groups/application/public-enrollment'

const invitationToken = 'invitation-token'
const principal: CredentialGroupEnrollmentPrincipal = {
  kind: 'credential_group_enrollment',
  workspaceId: 'workspace-1',
  credentialGroupId: 'group-1',
  enrollmentId: 'enrollment-1',
  email: 'person@example.com',
  invitationTokenHash: sha256Hex(invitationToken),
}
const identity = {
  workspaceId: principal.workspaceId,
  credentialGroupId: principal.credentialGroupId,
  enrollmentId: principal.enrollmentId,
  email: principal.email,
  invitationTokenHash: principal.invitationTokenHash,
}

describe('public Credential Group enrollment application operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getEnrollment.mockResolvedValue({ status: 'invited', options: [] })
    mocks.getOAuthContext.mockResolvedValue({
      enrollmentId: 'enrollment-1',
      credentialGroupId: 'group-1',
      option: { id: 'option-1' },
    })
    mocks.startOAuth.mockResolvedValue('https://accounts.example/authorize')
  })

  it('rejects a workspace session before resolving invitation data', async () => {
    const session: SessionPrincipal = {
      kind: 'session',
      userId: 'user-1',
      sessionId: 'session-1',
    }

    await expect(
      readPublicCredentialGroupEnrollment.execute({ principal: session, input: {} })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.getEnrollment).not.toHaveBeenCalled()
  })

  it('revalidates the invitation identity before returning enrollment metadata', async () => {
    const result = await readPublicCredentialGroupEnrollment.execute({ principal, input: {} })

    expect(mocks.getEnrollment).toHaveBeenCalledWith(identity)
    expect(result).toEqual({ enrollment: { status: 'invited', options: [] } })
  })

  it('fails closed when the current invitation no longer resolves', async () => {
    mocks.getEnrollment.mockResolvedValue(null)

    await expect(
      readPublicCredentialGroupEnrollment.execute({ principal, input: {} })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rejects a substituted bearer before creating provider state', async () => {
    await expect(
      startPublicCredentialGroupOAuth.execute({
        principal,
        input: { invitationToken: 'different-token', optionId: 'option-1' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.startOAuth).not.toHaveBeenCalled()
  })

  it('starts OAuth only for the option bound to the current enrollment principal', async () => {
    const result = await startPublicCredentialGroupOAuth.execute({
      principal,
      input: { invitationToken, optionId: 'option-1' },
    })

    expect(mocks.getOAuthContext).toHaveBeenCalledWith(identity, 'option-1')
    expect(result).toEqual({ authorizationUrl: 'https://accounts.example/authorize' })
  })
})
