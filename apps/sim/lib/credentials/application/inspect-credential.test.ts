import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  permission: vi.fn(),
  actor: vi.fn(),
  account: vi.fn(),
}))
vi.mock('@/lib/credentials/application/credential-context', () => ({
  resolveCredentialApplicationContext: mocks.context,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null) => Boolean(permission),
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/credentials/access', () => ({ getCredentialActorContext: mocks.actor }))
vi.mock('@/lib/credentials/queries', () => ({ readCredentialAccountMetadata: mocks.account }))

import { inspectCredential } from '@/lib/credentials/application/inspect-credential'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'

const principal = { kind: 'personal_api_key' as const, userId: 'actor-1', keyId: 'key-1' }
const input = { credentialId: 'credential-1', assertedWorkspaceId: 'workspace-1' }
const credential = {
  id: 'credential-1',
  type: 'oauth',
  workspaceId: 'workspace-1',
  accountId: 'account-1',
  providerId: 'slack',
  displayName: 'A friendly label',
}
const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner',
  credential,
}

beforeEach(() => {
  mocks.context.mockResolvedValue({ ...context })
  mocks.permission.mockResolvedValue('read')
  mocks.actor.mockResolvedValue({
    credential,
    member: { role: 'member', status: 'active' },
    hasWorkspaceAccess: true,
    isAdmin: false,
  })
  mocks.account.mockResolvedValue({
    externalAccountId: 'T123-U456-connection-id',
    scope: 'chat:write, files:read\nchat:write',
  })
})

describe('inspectCredential', () => {
  it('reports recorded OAuth identity and scopes without claiming a live bot identity', async () => {
    const { diagnostics } = await inspectCredential.execute({ principal, input })
    expect(mocks.context).toHaveBeenCalledWith(input)
    expect(mocks.actor).toHaveBeenCalledWith('credential-1', 'actor-1', {
      workspaceId: 'workspace-1',
    })
    expect(mocks.account).toHaveBeenCalledWith('account-1', 'slack')
    expect(diagnostics.identity).toEqual({
      source: 'linked-account',
      subjectId: null,
      tenantId: 'T123',
      externalAccountId: 'T123-U456-connection-id',
      verifiedLive: false,
    })
    expect(diagnostics.scopes).toEqual({
      source: 'linked-account',
      values: ['chat:write', 'files:read'],
    })
    expect(diagnostics.notes.join(' ')).toContain('conversation membership')
    expect(JSON.stringify(diagnostics)).not.toContain('billing-owner')
    expect(JSON.stringify(diagnostics)).not.toContain('A friendly label')
  })

  it('denies workspace access before reading account metadata', async () => {
    mocks.permission.mockResolvedValue(null)
    await expect(inspectCredential.execute({ principal, input })).rejects.toThrow()
    expect(mocks.actor).not.toHaveBeenCalled()
    expect(mocks.account).not.toHaveBeenCalled()
  })

  it('prefers explicit managed OAuth identity and grants when recorded', async () => {
    mocks.context.mockResolvedValue({
      ...context,
      credential: {
        ...credential,
        providerSubjectId: 'provider-user',
        providerTenantId: 'tenant',
        grantedScopes: ['read'],
      },
    })
    const { diagnostics } = await inspectCredential.execute({ principal, input })
    expect(diagnostics.identity).toMatchObject({
      source: 'credential',
      subjectId: 'provider-user',
      tenantId: 'tenant',
      verifiedLive: false,
    })
    expect(diagnostics.scopes).toEqual({ source: 'credential', values: ['read'] })
  })

  it('keeps custom-bot identity and grants unknown when stored only inside secret material', async () => {
    mocks.context.mockResolvedValue({
      ...context,
      credential: {
        ...credential,
        type: 'service_account',
        providerId: SLACK_CUSTOM_BOT_PROVIDER_ID,
        accountId: null,
        encryptedServiceAccountKey: 'DO-NOT-DECRYPT',
      },
    })
    const { diagnostics } = await inspectCredential.execute({ principal, input })
    expect(diagnostics.identity.source).toBe('unknown')
    expect(diagnostics.scopes).toEqual({ source: 'unknown', values: [] })
    expect(diagnostics.notes.join(' ')).toContain('not decrypted')
    expect(JSON.stringify(diagnostics)).not.toContain('DO-NOT-DECRYPT')
    expect(mocks.account).not.toHaveBeenCalled()
  })

  it('reports missing linked account metadata as unknown', async () => {
    mocks.account.mockResolvedValue(null)
    const { diagnostics } = await inspectCredential.execute({ principal, input })
    expect(diagnostics.identity.source).toBe('unknown')
    expect(diagnostics.scopes.source).toBe('unknown')
  })

  it('denies nonmembers before reading linked account metadata', async () => {
    mocks.actor.mockResolvedValue({
      credential,
      member: null,
      hasWorkspaceAccess: true,
      isAdmin: false,
    })
    await expect(inspectCredential.execute({ principal, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.account).not.toHaveBeenCalled()
  })

  it('conceals an actor lookup in a different workspace', async () => {
    mocks.actor.mockResolvedValue({
      credential: { ...credential, workspaceId: 'other' },
      member: { role: 'member' },
      hasWorkspaceAccess: true,
      isAdmin: false,
    })
    await expect(inspectCredential.execute({ principal, input })).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(mocks.account).not.toHaveBeenCalled()
  })

  it('denies workspace keys before canonical or account loading', async () => {
    await expect(
      inspectCredential.execute({
        principal: { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key' },
        input,
      })
    ).rejects.toThrow()
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.account).not.toHaveBeenCalled()
  })

  it('does not expose secret credential types through an API principal', async () => {
    mocks.context.mockResolvedValue({
      ...context,
      credential: { ...credential, type: 'env_workspace' },
    })
    await expect(inspectCredential.execute({ principal, input })).rejects.toMatchObject({
      code: 'validation',
    })
    expect(mocks.account).not.toHaveBeenCalled()
  })
})
