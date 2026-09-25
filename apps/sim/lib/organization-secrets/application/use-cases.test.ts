import { member } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  configure: vi.fn(),
  remove: vi.fn(),
  names: vi.fn(),
  mount: vi.fn(),
  config: vi.fn(),
  audit: vi.fn(),
}))
vi.mock('@/lib/organization-secrets/repository', () => ({
  readSecrets: mocks.read,
  saveSecrets: mocks.save,
  configureSecretSource: mocks.configure,
  removeSecretSource: mocks.remove,
  listSecretNames: mocks.names,
  materializeSecrets: mocks.mount,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.config,
}))
vi.mock('@sim/audit', async (original) => ({
  ...(await original<typeof import('@sim/audit')>()),
  recordAudit: mocks.audit,
}))

import { ORGANIZATION_SECRETS_AUDIENCE } from '@/lib/organization-secrets/application/operations'
import {
  configureOrganizationSecretSource,
  listOrganizationSecretNames,
  mountOrganizationSecrets,
  readOrganizationSecrets,
  removeOrganizationSecretSource,
  saveOrganizationSecrets,
} from '@/lib/organization-secrets/application/use-cases'

const principal = { kind: 'session', userId: 'actor', sessionId: 'session' } as const
const delegated = () => ({
  kind: 'organization_delegated' as const,
  serviceId: 'copilot' as const,
  subjectUserId: 'actor',
  organizationId: 'org',
  delegationId: 'call',
  audience: ORGANIZATION_SECRETS_AUDIENCE,
  issuedAt: new Date(Date.now() - 1000),
  expiresAt: new Date(Date.now() + 60_000),
  resourceScope: { chatId: 'chat' },
})
beforeEach(() => {
  resetDbChainMock()
  mocks.config.mockResolvedValue(null)
})

describe('Generic Secrets authorization', () => {
  it.each(['admin', 'owner'])(
    'lets a current %s save shared keys but rejects a later membership revocation',
    async (role) => {
      const input = {
        organizationId: 'org',
        sourceId: 'source',
        mode: 'organization',
        upsert: { TOKEN: 'new-secret' },
        remove: [],
      } as const
      queueTableRows(member, [{ role }])
      await saveOrganizationSecrets.execute({ principal, input: { ...input, remove: [] } })
      expect(mocks.save).toHaveBeenCalledWith(
        { organizationId: 'org', userId: 'actor', role },
        { id: 'source', mode: 'organization' },
        { upsert: { TOKEN: 'new-secret' }, remove: [] }
      )
      queueTableRows(member, [])
      await expect(
        saveOrganizationSecrets.execute({ principal, input: { ...input, remove: [] } })
      ).rejects.toMatchObject({ code: 'forbidden' })
      expect(mocks.save).toHaveBeenCalledOnce()
      expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('new-secret')
    }
  )

  it('rechecks the secrets capability when a member submits a key', async () => {
    queueTableRows(member, [{ role: 'member' }])
    mocks.config.mockResolvedValue({ hideSecretsTab: true })
    await expect(
      saveOrganizationSecrets.execute({
        principal,
        input: {
          organizationId: 'org',
          sourceId: 'source',
          mode: 'member',
          upsert: { TOKEN: 'new-secret' },
          remove: [],
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it.each(['configure', 'remove'])('denies source %s to a member', async (action) => {
    queueTableRows(member, [{ role: 'member' }])
    const call =
      action === 'configure'
        ? configureOrganizationSecretSource.execute({
            principal,
            input: { organizationId: 'org', sourceId: null, mode: 'member' },
          })
        : removeOrganizationSecretSource.execute({
            principal,
            input: { organizationId: 'org', sourceId: 'source' },
          })
    await expect(call).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.configure).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('never lets a member read or change organization values', async () => {
    for (const action of ['read', 'save']) {
      queueTableRows(member, [{ role: 'member' }])
      await expect(
        action === 'read'
          ? readOrganizationSecrets.execute({
              principal,
              input: { organizationId: 'org', mode: 'organization' },
            })
          : saveOrganizationSecrets.execute({
              principal,
              input: {
                organizationId: 'org',
                sourceId: 'source',
                mode: 'organization',
                upsert: { TOKEN: 'value' },
                remove: [],
              },
            })
      ).rejects.toMatchObject({ code: 'forbidden' })
    }
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('denies outsiders before reading values', async () => {
    queueTableRows(member, [])
    await expect(
      readOrganizationSecrets.execute({
        principal,
        input: { organizationId: 'other-org', mode: 'member' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it.each(['workspace_api_key', 'delegated'])(
    'rejects %s without a membership query',
    async (kind) => {
      await expect(
        readOrganizationSecrets.execute({
          principal: { ...principal, kind } as never,
          input: { organizationId: 'org', mode: 'member' },
        })
      ).rejects.toThrow()
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
    }
  )
  it('records changed keys without values', async () => {
    queueTableRows(member, [{ role: 'member' }])
    await saveOrganizationSecrets.execute({
      principal,
      input: {
        organizationId: 'org',
        sourceId: 'source',
        mode: 'member',
        upsert: { TOKEN: 'secret-value' },
        remove: ['OLD'],
      },
    })
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'actor' }),
      { id: 'source', mode: 'member' },
      { upsert: { TOKEN: 'secret-value' }, remove: ['OLD'] }
    )
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('secret-value')
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ keys: ['TOKEN', 'OLD'] }) })
    )
  })
  it('rechecks the delegated member and resolves only their active environment', async () => {
    queueTableRows(member, [{ role: 'member' }])
    await mountOrganizationSecrets.execute({
      principal: delegated(),
      input: { organizationId: 'org', names: ['TOKEN', 'TOKEN'] },
    })
    expect(mocks.mount).toHaveBeenCalledWith(
      { organizationId: 'org', userId: 'actor', role: 'member' },
      ['TOKEN']
    )
    queueTableRows(member, [])
    await expect(
      mountOrganizationSecrets.execute({
        principal: delegated(),
        input: { organizationId: 'org', names: ['TOKEN'] },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.mount).toHaveBeenCalledOnce()
  })
  it.each([
    { organizationId: 'other' },
    { audience: 'sim:knowledge' },
    { expiresAt: new Date(0) },
    { serviceId: 'slack-search' },
  ])('rejects invalid runtime authority %j', async (override) => {
    await expect(
      listOrganizationSecretNames.execute({
        principal: { ...delegated(), ...override } as never,
        input: { organizationId: 'org' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.names).not.toHaveBeenCalled()
  })
})
