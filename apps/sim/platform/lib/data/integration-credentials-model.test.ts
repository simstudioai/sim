/**
 * @vitest-environment node
 *
 * The credential page's access table proposes a whole member list, which the server applies as the
 * credential's explicit grants. Failure modes: the viewer revoking their own access sent as a
 * removal, which the server refuses for the last admin where leaving succeeds; an inherited
 * workspace-admin grant proposed as an explicit one; a pending grant managing the credential; and a
 * workspace secret or a credential without a provider listed on an app's page.
 */
import { describe, expect, it } from 'vitest'
import type { WorkspaceCredential } from '@/lib/api/contracts/credentials'
import {
  credentialGrants,
  toWorkspaceIntegrationCredential,
} from '@/platform/lib/data/integration-credentials-model'
import type { CredentialMember } from '@/platform/lib/integrations/credential-model'

const VIEWER = 'viewer'

function member(userId: string, overrides: Partial<CredentialMember> = {}): CredentialMember {
  return {
    id: userId,
    userId,
    name: userId,
    role: 'member',
    roleSource: 'explicit',
    explicitAdmin: false,
    status: 'active',
    ...overrides,
  }
}

describe('credentialGrants', () => {
  it('keeps the viewer’s own grant when they revoke it, leaving that to the leave operation', () => {
    const previous = [member(VIEWER, { role: 'admin', explicitAdmin: true }), member('ana')]
    const next = [member(VIEWER, { role: 'admin', status: 'revoked' }), member('ana')]
    expect(credentialGrants(previous, next, VIEWER)).toEqual([
      { userId: VIEWER, role: 'admin' },
      { userId: 'ana', role: 'member' },
    ])
  })

  it('drops someone else whose access was revoked', () => {
    const previous = [member('ana'), member('bo')]
    const next = [member('ana', { status: 'revoked' }), member('bo')]
    expect(credentialGrants(previous, next, VIEWER)).toEqual([{ userId: 'bo', role: 'member' }])
  })

  it('never proposes an inherited grant as an explicit one', () => {
    const inherited = member('admin', { role: 'admin', roleSource: 'workspace-admin' })
    expect(credentialGrants([], [inherited], VIEWER)).toEqual([])
  })
})

describe('toWorkspaceIntegrationCredential', () => {
  const workspace = { id: 'ws', name: 'Acme' }
  const base: WorkspaceCredential = {
    id: 'cred',
    workspaceId: 'ws',
    type: 'oauth',
    displayName: 'Inbox',
    description: null,
    unredacted: false,
    providerId: 'google-email',
    accountId: null,
    envKey: null,
    envOwnerUserId: null,
    createdBy: 'owner',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const project = (credential: WorkspaceCredential) =>
    toWorkspaceIntegrationCredential(credential, { appId: 'gmail', workspace, canReconnect: true })

  it('keeps workspace secrets and provider-less credentials off an app’s page', () => {
    expect(project({ ...base, type: 'env_workspace' })).toBeNull()
    expect(project({ ...base, providerId: null })).toBeNull()
  })

  it('reads a credential without a role as a member, so its details stay view-only', () => {
    expect(project(base)?.role).toBe('member')
  })

  it('grants a pending admin no admin role until their grant is active', () => {
    expect(project({ ...base, role: 'admin', status: 'pending' })?.role).toBe('member')
  })

  it('scopes a personal token to whoever connected it, and anything else to the workspace', () => {
    expect(project({ ...base, type: 'personal_token' })?.scope).toEqual({
      kind: 'personal',
      ownerId: 'owner',
    })
    expect(project(base)?.scope).toEqual({ kind: 'workspace', id: 'ws', name: 'Acme' })
  })
})
