/**
 * @vitest-environment node
 */
import { resolvePrincipalAttribution, toPrincipalActor } from '@sim/auth/principal'
import { describe, expect, it } from 'vitest'

describe('principal actors', () => {
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
})
