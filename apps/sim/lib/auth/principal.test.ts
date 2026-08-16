/**
 * @vitest-environment node
 */
import {
  PrincipalSubjectUserRequiredError,
  requirePrincipalSubjectUserId,
  resolvePrincipalAttribution,
  resolvePrincipalAuditAttribution,
  toPrincipalActor,
} from '@sim/auth/principal'
import { describe, expect, it } from 'vitest'

describe('principal subject users', () => {
  it('resolves the human subject represented by user-backed principals', () => {
    expect(
      requirePrincipalSubjectUserId({
        kind: 'session',
        userId: 'session-user',
        sessionId: 'session-1',
      })
    ).toBe('session-user')
    expect(
      requirePrincipalSubjectUserId({
        kind: 'personal_api_key',
        userId: 'key-user',
        keyId: 'key-1',
      })
    ).toBe('key-user')
    expect(
      requirePrincipalSubjectUserId({
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'delegated-user',
        workspaceId: 'workspace-1',
        delegationId: 'delegation-1',
        audience: 'sim:test',
        issuedAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2026-01-01T00:05:00Z'),
      })
    ).toBe('delegated-user')
  })

  it('fails fast instead of fabricating a workspace-key subject', () => {
    expect(() =>
      requirePrincipalSubjectUserId({
        kind: 'workspace_api_key',
        keyId: 'key-1',
        workspaceId: 'workspace-1',
      })
    ).toThrow(PrincipalSubjectUserRequiredError)
  })

  it('fails fast instead of fabricating a Sim user for an external enrollment', () => {
    expect(() =>
      requirePrincipalSubjectUserId({
        kind: 'credential_group_enrollment',
        workspaceId: 'workspace-1',
        credentialGroupId: 'group-1',
        enrollmentId: 'enrollment-1',
        email: 'person@example.com',
        invitationTokenHash: 'hash-1',
      })
    ).toThrow(PrincipalSubjectUserRequiredError)
  })
})

describe('principal actors', () => {
  it('maps every principal to an audit actor without billing-owner substitution', () => {
    expect(
      resolvePrincipalAuditAttribution({
        kind: 'session',
        userId: 'user-1',
        sessionId: 'session-1',
      })
    ).toEqual({
      actor: { kind: 'session', userId: 'user-1' },
      actorId: 'user-1',
    })
    expect(
      resolvePrincipalAuditAttribution({
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-2',
        workspaceId: 'workspace-1',
        delegationId: 'delegation-1',
        audience: 'sim:workspace-files',
        issuedAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2026-01-01T00:05:00Z'),
      })
    ).toMatchObject({ actorId: 'user-2' })
    expect(
      resolvePrincipalAuditAttribution({
        kind: 'workspace_api_key',
        keyId: 'key-1',
        workspaceId: 'workspace-1',
      })
    ).toEqual({
      actor: { kind: 'workspace_api_key', keyId: 'key-1', workspaceId: 'workspace-1' },
      actorId: null,
      actorName: 'Workspace API key',
    })
    expect(
      resolvePrincipalAuditAttribution({
        kind: 'credential_group_enrollment',
        workspaceId: 'workspace-1',
        credentialGroupId: 'group-1',
        enrollmentId: 'enrollment-1',
        email: 'person@example.com',
        invitationTokenHash: 'hash-1',
      })
    ).toEqual({
      actor: {
        kind: 'credential_group_enrollment',
        workspaceId: 'workspace-1',
        credentialGroupId: 'group-1',
        enrollmentId: 'enrollment-1',
        email: 'person@example.com',
      },
      actorId: null,
      actorName: 'person@example.com',
    })
  })

  it('projects principals into their shared actor identity', () => {
    expect(
      toPrincipalActor({ kind: 'personal_api_key', keyId: 'key-1', userId: 'user-1' })
    ).toEqual({ kind: 'personal_api_key', keyId: 'key-1', userId: 'user-1' })

    expect(
      toPrincipalActor({
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-1',
        workspaceId: 'workspace-1',
        delegationId: 'delegation-1',
        audience: 'sim:workspace-files',
        issuedAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2026-01-01T00:05:00Z'),
      })
    ).toEqual({
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: 'user-1',
      delegationId: 'delegation-1',
    })
  })

  it('uses the workspace billing owner for workspace-key attribution', () => {
    expect(
      resolvePrincipalAttribution(
        { kind: 'workspace_api_key', keyId: 'key-1', workspaceId: 'workspace-1' },
        { workspaceBillingOwnerUserId: 'billing-owner-1' }
      )
    ).toEqual({
      actor: { kind: 'workspace_api_key', keyId: 'key-1', workspaceId: 'workspace-1' },
      attributedUserId: 'billing-owner-1',
    })
  })

  it('attributes user-backed principals to their human subject', () => {
    expect(
      resolvePrincipalAttribution({ kind: 'session', userId: 'user-1', sessionId: 'session-1' })
    ).toMatchObject({ attributedUserId: 'user-1' })
    expect(
      resolvePrincipalAttribution({
        kind: 'personal_api_key',
        keyId: 'key-1',
        userId: 'user-2',
      })
    ).toMatchObject({ attributedUserId: 'user-2' })
    expect(
      resolvePrincipalAttribution({
        kind: 'delegated',
        serviceId: 'copilot',
        subjectUserId: 'user-3',
        workspaceId: 'workspace-1',
        delegationId: 'delegation-1',
        audience: 'sim:workspace-files',
        issuedAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2026-01-01T00:05:00Z'),
      })
    ).toMatchObject({ attributedUserId: 'user-3' })
  })

  it('fails fast when workspace-key attribution has no billing owner', () => {
    expect(() =>
      resolvePrincipalAttribution({
        kind: 'workspace_api_key',
        keyId: 'key-1',
        workspaceId: 'workspace-1',
      })
    ).toThrow('Workspace API key attribution requires a workspace billing owner')
  })

  it('fails fast when external enrollment identity is used for user attribution', () => {
    expect(() =>
      resolvePrincipalAttribution({
        kind: 'credential_group_enrollment',
        workspaceId: 'workspace-1',
        credentialGroupId: 'group-1',
        enrollmentId: 'enrollment-1',
        email: 'person@example.com',
        invitationTokenHash: 'hash-1',
      })
    ).toThrow(PrincipalSubjectUserRequiredError)
  })
})
