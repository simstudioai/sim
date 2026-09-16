/** @vitest-environment node */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ policy: vi.fn(), available: vi.fn() }))
vi.mock('@/lib/resource-policies/repository', () => ({ requireResourcePolicy: mocks.policy }))
vi.mock('@/lib/credential-groups/scoped-availability', () => ({
  isScopedCredentialGroupsAvailable: mocks.available,
}))

import { buildOrganizationAccountAccessPolicy } from '@/lib/credential-groups/application/workspace-access-policy'
import { filterWorkspaceAccountCredentials } from '@/lib/credentials/application/workspace-account-visibility'

const context = { workspaceId: 'ws', workspaceOrganizationId: 'org', allowPersonalApiKeys: true }
const entries = [
  { id: 'ordinary', type: 'oauth', providerId: 'google-email' },
  { id: 'mail', type: 'managed_oauth', providerId: 'google-email' },
  { id: 'calendar', type: 'managed_oauth', providerId: 'google-calendar' },
  { id: 'token', type: 'personal_token', providerId: 'gitlab' },
]
const bindings = entries.slice(1).map((entry) => ({
  ...entry,
  organizationId: 'org',
  workspaceId: null,
  groupId: 'group',
  groupOrganizationId: 'org',
  groupWorkspaceId: null,
}))

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.available.mockResolvedValue(true)
  mocks.policy.mockResolvedValue({
    document: buildOrganizationAccountAccessPolicy('group', [
      {
        workspaceId: 'ws',
        access: { mode: 'selected', credentialTypes: ['oauth:gmail', 'personal_token:gitlab'] },
      },
    ]),
  })
})

describe('workspace organization credential visibility', () => {
  it('filters canonical OAuth and token types with a single policy read while preserving ordinary accounts', async () => {
    queueTableRows(schemaMock.credential, bindings)
    expect(await filterWorkspaceAccountCredentials(context, entries)).toEqual([
      entries[0],
      entries[1],
      entries[3],
    ])
    expect(mocks.policy).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ organizationId: 'org', resourceId: 'group' })
    )
    expect(dbChainMockFns.select).toHaveBeenCalledExactlyOnceWith({
      id: schemaMock.credential.id,
      organizationId: schemaMock.credential.organizationId,
      workspaceId: schemaMock.credential.workspaceId,
      groupId: schemaMock.credentialGroup.id,
      groupOrganizationId: schemaMock.credentialGroup.organizationId,
      groupWorkspaceId: schemaMock.credentialGroup.workspaceId,
      providerId: schemaMock.credential.providerId,
      type: schemaMock.credential.type,
    })
  })

  it('rechecks revocation and does not reuse a previously allowed selection', async () => {
    queueTableRows(schemaMock.credential, bindings)
    await filterWorkspaceAccountCredentials(context, entries)
    mocks.policy.mockResolvedValue({ document: buildOrganizationAccountAccessPolicy('group', []) })
    queueTableRows(schemaMock.credential, bindings)
    expect(await filterWorkspaceAccountCredentials(context, entries)).toEqual([entries[0]])
  })

  it.each([null, 'other-org'])(
    'hides organization accounts when the workspace belongs to %s',
    async (workspaceOrganizationId) => {
      queueTableRows(schemaMock.credential, bindings)
      expect(
        await filterWorkspaceAccountCredentials({ ...context, workspaceOrganizationId }, entries)
      ).toEqual([entries[0]])
      expect(mocks.policy).not.toHaveBeenCalled()
    }
  )

  it('fails closed for removed bindings and a disabled feature', async () => {
    queueTableRows(schemaMock.credential, [])
    expect(await filterWorkspaceAccountCredentials(context, entries)).toEqual([entries[0]])
    mocks.available.mockResolvedValue(false)
    queueTableRows(schemaMock.credential, bindings)
    expect(await filterWorkspaceAccountCredentials(context, entries)).toEqual([entries[0]])
    expect(mocks.policy).not.toHaveBeenCalled()
  })

  it('preserves independently managed workspace accounts', async () => {
    queueTableRows(
      schemaMock.credential,
      bindings.map((binding) => ({
        ...binding,
        organizationId: null,
        workspaceId: 'ws',
        groupOrganizationId: null,
        groupWorkspaceId: 'ws',
      }))
    )
    expect(await filterWorkspaceAccountCredentials(context, entries)).toEqual(entries)
    expect(mocks.available).not.toHaveBeenCalled()
    expect(mocks.policy).not.toHaveBeenCalled()
  })

  it.each([
    { groupOrganizationId: 'other-org', groupWorkspaceId: null },
    { groupOrganizationId: null, groupWorkspaceId: 'ws' },
  ])('rejects mismatched group ownership before loading policy: %j', async (owner) => {
    queueTableRows(
      schemaMock.credential,
      bindings.map((binding) => ({ ...binding, ...owner }))
    )
    await expect(filterWorkspaceAccountCredentials(context, entries)).rejects.toThrow(
      'Credential and enrollment group owners do not match'
    )
    expect(mocks.policy).not.toHaveBeenCalled()
  })

  it('hides independently managed credentials that moved to another workspace', async () => {
    queueTableRows(
      schemaMock.credential,
      bindings.map((binding) => ({
        ...binding,
        organizationId: null,
        workspaceId: 'other-ws',
        groupOrganizationId: null,
        groupWorkspaceId: 'other-ws',
      }))
    )
    expect(await filterWorkspaceAccountCredentials(context, entries)).toEqual([entries[0]])
    expect(mocks.policy).not.toHaveBeenCalled()
  })

  it('throws for malformed policy or a changed canonical provider instead of granting access', async () => {
    queueTableRows(schemaMock.credential, bindings)
    mocks.policy.mockRejectedValueOnce(new Error('Malformed policy'))
    await expect(filterWorkspaceAccountCredentials(context, entries)).rejects.toThrow(
      'Malformed policy'
    )
    queueTableRows(
      schemaMock.credential,
      bindings.map((binding) => ({ ...binding, providerId: 'slack' }))
    )
    await expect(filterWorkspaceAccountCredentials(context, entries)).rejects.toThrow(
      'binding changed'
    )
  })
})
