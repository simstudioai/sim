/**
 * @vitest-environment node
 */
import type { CredentialGroupEnrollmentPrincipal, SessionPrincipal } from '@sim/auth/principal'
import { sha256Hex } from '@sim/security/hash'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  bind: vi.fn(),
  completeEnrollment: vi.fn(),
  completeOAuth: vi.fn(),
  fireTrigger: vi.fn(),
  getEnrollment: vi.fn(),
  getMcpOAuthContext: vi.fn(),
  getOAuthContext: vi.fn(),
  getAttemptContext: vi.fn(),
  getMcpAttemptContext: vi.fn(),
  completeMcpOAuth: vi.fn(),
  startMcpOAuth: vi.fn(),
  startOAuth: vi.fn(),
}))

vi.mock('@/lib/credential-groups/enrollments', () => ({
  bindCredentialGroupEnrollmentUser: mocks.bind,
  completeAuthorizedCredentialGroupEnrollment: mocks.completeEnrollment,
  getAuthorizedCredentialGroupMcpOAuthContext: mocks.getMcpOAuthContext,
  getAuthorizedCredentialGroupOAuthContext: mocks.getOAuthContext,
  getCredentialGroupOAuthContextForEnrollment: mocks.getAttemptContext,
  getCredentialGroupMcpOAuthContextForEnrollment: mocks.getMcpAttemptContext,
  getAuthorizedPublicCredentialGroupEnrollment: mocks.getEnrollment,
}))

vi.mock('@/lib/credential-groups/mcp-oauth', () => ({
  completeCredentialGroupMcpOAuth: mocks.completeMcpOAuth,
  startCredentialGroupMcpOAuth: mocks.startMcpOAuth,
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
  completePublicCredentialGroupMcpOAuth,
  completePublicCredentialGroupOAuth,
  readPublicCredentialGroupEnrollment,
  startPublicCredentialGroupMcpOAuth,
  startPublicCredentialGroupOAuth,
} from '@/lib/credential-groups/application/public-enrollment'

const invitationToken = 'invitation-token'
const principal: CredentialGroupEnrollmentPrincipal = {
  kind: 'credential_group_enrollment',
  userId: 'user-1',
  organizationId: 'org-1',
  credentialGroupId: 'group-1',
  enrollmentId: 'enrollment-1',
  email: 'person@example.com',
  invitationTokenHash: sha256Hex(invitationToken),
}
const identity = {
  organizationId: principal.organizationId,
  userId: principal.userId,
  credentialGroupId: principal.credentialGroupId,
  enrollmentId: principal.enrollmentId,
  email: principal.email,
  invitationTokenHash: principal.invitationTokenHash,
}
const oauthAttempt = {
  organizationId: principal.organizationId,
  userId: principal.userId,
  email: principal.email,
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
    mocks.bind.mockResolvedValue(undefined)
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
    mocks.getAttemptContext.mockResolvedValue({
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
    mocks.getMcpOAuthContext.mockResolvedValue({
      enrollmentId: 'enrollment-1',
      credentialGroupId: 'group-1',
      server: { id: 'mcp-server-1' },
    })
    mocks.startOAuth.mockResolvedValue('https://accounts.example/authorize')
    mocks.startMcpOAuth.mockResolvedValue('https://mcp.example/authorize')
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

    expect(mocks.getEnrollment).toHaveBeenCalledWith(identity, undefined)
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

  it('projects only the requested option after authenticating the current invitation', async () => {
    await readPublicCredentialGroupEnrollment.execute({
      principal,
      input: { optionId: 'confluence-site-two' },
    })
    expect(mocks.getEnrollment).toHaveBeenCalledExactlyOnceWith(identity, {
      optionId: 'confluence-site-two',
    })
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

  it('keeps the Search return context with the exact authorized OAuth option', async () => {
    await startPublicCredentialGroupOAuth.execute({
      principal,
      input: { invitationToken, optionId: 'option-1', returnTo: 'search' },
    })
    expect(mocks.getOAuthContext).toHaveBeenCalledWith(identity, 'option-1')
    expect(mocks.startOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ option: { id: 'option-1', provider: 'gmail' } }),
      invitationToken,
      { returnTo: 'search' }
    )
    expect(mocks.completeEnrollment).not.toHaveBeenCalled()
  })

  it('rejects a substituted bearer before creating managed MCP state', async () => {
    await expect(
      startPublicCredentialGroupMcpOAuth.execute({
        principal,
        input: { invitationToken: 'different-token', mcpServerId: 'mcp-server-1' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.startMcpOAuth).not.toHaveBeenCalled()
  })

  it('starts managed MCP OAuth only for a server linked to the current invitation', async () => {
    const result = await startPublicCredentialGroupMcpOAuth.execute({
      principal,
      input: { invitationToken, mcpServerId: 'mcp-server-1' },
    })

    expect(mocks.getMcpOAuthContext).toHaveBeenCalledWith(identity, 'mcp-server-1')
    expect(mocks.startMcpOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ server: { id: 'mcp-server-1' } }),
      invitationToken
    )
    expect(result).toEqual({ authorizationUrl: 'https://mcp.example/authorize' })
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
      organizationId: 'org-1',
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
  it('rejects a consumed attempt after invitation rotation before exchanging its code', async () => {
    mocks.bind.mockRejectedValue(new Error('Invitation is invalid or expired'))
    await expect(
      completePublicCredentialGroupOAuth.execute({
        principal,
        input: { attempt: oauthAttempt, code: 'code' },
      })
    ).rejects.toThrow('Invitation is invalid or expired')
    expect(mocks.completeOAuth).not.toHaveBeenCalled()
  })
  it.each([
    { organizationId: 'other' },
    { userId: 'other-user' },
    { credentialGroupId: 'other' },
    { enrollmentId: 'other' },
    { email: 'other@example.com' },
    { invitationToken: 'other' },
  ])('refuses an attempt that does not match its bounded principal', async (override) => {
    await expect(
      completePublicCredentialGroupOAuth.execute({
        principal,
        input: { attempt: { ...oauthAttempt, ...override }, code: 'code' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.getAttemptContext).not.toHaveBeenCalled()
    expect(mocks.completeOAuth).not.toHaveBeenCalled()
  })
  it('rechecks live enrollment authority before exchanging the authorization code', async () => {
    mocks.getAttemptContext.mockResolvedValue(null)
    await expect(
      completePublicCredentialGroupOAuth.execute({
        principal,
        input: { attempt: oauthAttempt, code: 'code' },
      })
    ).rejects.toThrow('revoked')
    expect(mocks.completeOAuth).not.toHaveBeenCalled()
    expect(mocks.fireTrigger).not.toHaveBeenCalled()
  })
  it('emits the personal MCP connection ID after completing the current configuration', async () => {
    const attempt = {
      ...oauthAttempt,
      mcpServerId: 'mcp-server-1',
      oauthConfigVersion: 2,
      codeVerifier: 'verifier',
    }
    mocks.getMcpAttemptContext.mockResolvedValue({
      credentialGroupName: 'Accounts',
      server: {
        id: 'mcp-server-1',
        connectorId: 'fireflies',
        name: 'Fireflies',
        oauthConfigVersion: 2,
      },
    })
    mocks.completeMcpOAuth.mockResolvedValue({
      connectionId: 'mcp-cg-person',
      mcpServerId: 'mcp-server-1',
      created: true,
      enrollmentStatus: 'in_progress',
    })
    await expect(
      completePublicCredentialGroupMcpOAuth.execute({ principal, input: { attempt, code: 'code' } })
    ).resolves.toEqual({ connectionId: 'mcp-cg-person', mcpServerId: 'mcp-server-1' })
    expect(mocks.completeMcpOAuth).toHaveBeenCalledWith(
      expect.any(Object),
      'verifier',
      'code',
      invitationToken
    )
    expect(mocks.fireTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'credential_added',
        organizationId: 'org-1',
        credential: expect.objectContaining({
          credentialId: 'mcp-cg-person',
          mcpServerId: 'mcp-server-1',
        }),
      })
    )
  })

  it('rejects a changed MCP configuration before exchanging the code', async () => {
    mocks.getMcpAttemptContext.mockResolvedValue({ server: { oauthConfigVersion: 3 } })
    await expect(
      completePublicCredentialGroupMcpOAuth.execute({
        principal,
        input: {
          attempt: {
            ...oauthAttempt,
            mcpServerId: 'mcp-server-1',
            oauthConfigVersion: 2,
            codeVerifier: 'verifier',
          },
          code: 'code',
        },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(mocks.completeMcpOAuth).not.toHaveBeenCalled()
  })

  it('rejects a pending MCP attempt after disconnect rotates its invitation', async () => {
    mocks.bind.mockRejectedValue(new Error('Invitation is invalid or expired'))
    await expect(
      completePublicCredentialGroupMcpOAuth.execute({
        principal,
        input: {
          attempt: {
            ...oauthAttempt,
            mcpServerId: 'mcp-server-1',
            oauthConfigVersion: 2,
            codeVerifier: 'verifier',
          },
          code: 'code',
        },
      })
    ).rejects.toThrow('Invitation is invalid or expired')
    expect(mocks.completeMcpOAuth).not.toHaveBeenCalled()
  })

  it.each([
    'organizationId',
    'userId',
    'credentialGroupId',
    'enrollmentId',
    'email',
    'invitationToken',
  ] as const)('rejects forged MCP attempt %s before server lookup', async (field) => {
    const attempt = {
      ...oauthAttempt,
      mcpServerId: 'mcp-server-1',
      codeVerifier: 'verifier',
      [field]: 'forged',
    }
    await expect(
      completePublicCredentialGroupMcpOAuth.execute({ principal, input: { attempt, code: 'code' } })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.getMcpAttemptContext).not.toHaveBeenCalled()
    expect(mocks.completeMcpOAuth).not.toHaveBeenCalled()
  })

  it('denies a pinned MCP attempt after enrollment revocation or server unlinking', async () => {
    mocks.getMcpAttemptContext.mockResolvedValue(null)
    await expect(
      completePublicCredentialGroupMcpOAuth.execute({
        principal,
        input: {
          attempt: { ...oauthAttempt, mcpServerId: 'mcp-server-1', codeVerifier: 'verifier' },
          code: 'code',
        },
      })
    ).rejects.toThrow('invitation was revoked')
    expect(mocks.completeMcpOAuth).not.toHaveBeenCalled()
  })
})
