/**
 * @vitest-environment node
 */
import type { CredentialGroupEnrollmentPrincipal, SessionPrincipal } from '@sim/auth/principal'
import { sha256Hex } from '@sim/security/hash'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  completeEnrollment: vi.fn(),
  completeOAuth: vi.fn(),
  fireTrigger: vi.fn(),
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
  completeCredentialGroupOAuth: mocks.completeOAuth,
  startCredentialGroupOAuth: mocks.startOAuth,
}))

vi.mock('@/lib/credential-groups/trigger', () => ({
  fireCredentialGroupTrigger: mocks.fireTrigger,
}))

import {
  completePublicCredentialGroupEnrollment,
  completePublicCredentialGroupOAuth,
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
const oauthAttempt = {
  state: 'state-1',
  provider: 'gmail' as const,
  nonceHash: 'nonce-hash',
  enrollmentId: principal.enrollmentId,
  credentialGroupId: principal.credentialGroupId,
  optionId: 'option-1',
  authorizationAppId: 'google:client',
  scopeVersion: 1,
  requiredScopes: ['openid'],
  redirectUri: 'https://sim.ai/api/auth/oauth2/callback/google-email',
  invitationToken,
  createdAt: Date.now(),
}

describe('public Credential Group enrollment application operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getEnrollment.mockResolvedValue({
      status: 'invited',
      credentialGroupName: 'Credential Group',
      options: [],
    })
    mocks.getOAuthContext.mockResolvedValue({
      enrollmentId: 'enrollment-1',
      credentialGroupId: 'group-1',
      credentialGroupName: 'Credential Group',
      option: { id: 'option-1', provider: 'gmail' },
    })
    mocks.completeOAuth.mockResolvedValue({
      created: true,
      credentialId: 'credential-1',
      credentialGroupOptionId: 'option-1',
      provider: 'gmail',
      providerId: 'google-email',
      displayName: 'person@example.com',
      enrollmentStatus: 'in_progress',
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
    expect(result).toEqual({
      enrollment: {
        status: 'invited',
        credentialGroupName: 'Credential Group',
        options: [],
      },
    })
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

  it('fires form submitted only for the first completion transition', async () => {
    mocks.completeEnrollment.mockResolvedValue({ completed: true, transitioned: true })

    const result = await completePublicCredentialGroupEnrollment.execute({
      principal,
      input: {},
    })

    expect(result).toEqual({ completed: true })
    expect(mocks.fireTrigger).toHaveBeenCalledWith({
      event: 'form_submitted',
      workspaceId: 'workspace-1',
      credentialGroupId: 'group-1',
      credentialGroupName: 'Credential Group',
      enrollmentId: 'enrollment-1',
      email: 'person@example.com',
      enrollmentStatus: 'completed',
    })

    vi.clearAllMocks()
    mocks.getEnrollment.mockResolvedValue({
      status: 'completed',
      credentialGroupName: 'Credential Group',
      options: [],
    })
    mocks.completeEnrollment.mockResolvedValue({ completed: true, transitioned: false })

    await completePublicCredentialGroupEnrollment.execute({ principal, input: {} })

    expect(mocks.fireTrigger).not.toHaveBeenCalled()
  })

  it('distinguishes a new credential from a reconnection', async () => {
    await completePublicCredentialGroupOAuth.execute({
      principal,
      input: { attempt: oauthAttempt, code: 'authorization-code' },
    })

    expect(mocks.fireTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'credential_added',
        credentialGroupId: 'group-1',
        enrollmentId: 'enrollment-1',
        credential: expect.objectContaining({ credentialId: 'credential-1' }),
      })
    )

    vi.clearAllMocks()
    mocks.getOAuthContext.mockResolvedValue({
      enrollmentId: 'enrollment-1',
      credentialGroupId: 'group-1',
      credentialGroupName: 'Credential Group',
      option: { id: 'option-1', provider: 'gmail' },
    })
    mocks.completeOAuth.mockResolvedValue({
      created: false,
      credentialId: 'credential-1',
      credentialGroupOptionId: 'option-1',
      provider: 'gmail',
      providerId: 'google-email',
      displayName: 'person@example.com',
      enrollmentStatus: 'completed',
    })

    await completePublicCredentialGroupOAuth.execute({
      principal,
      input: { attempt: oauthAttempt, code: 'authorization-code' },
    })

    expect(mocks.fireTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'credential_reconnected', enrollmentStatus: 'completed' })
    )
  })
})
