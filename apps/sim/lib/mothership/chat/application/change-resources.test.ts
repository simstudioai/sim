import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import { beforeEach, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ resolve: vi.fn(), store: vi.fn() }))
vi.mock('@/lib/mothership/chat/application/context', () => ({
  resolveOwnedChatContext: hoisted.resolve,
}))
vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/mothership/resources/store', () => ({ changeStoredChatResources: hoisted.store }))

import { changeChatResources } from '@/lib/mothership/chat/application/change-resources'
import { createSearchResource } from '@/lib/mothership/resources/search'

const mocks = {
  ...hoisted,
  authorize: organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation,
}

const principal = createSessionPrincipal({ userId: 'reader', sessionId: 'session' })
beforeEach(() => {
  mocks.resolve.mockResolvedValue({ organizationId: 'org', chatId: 'chat', userId: 'reader' })
  mocks.authorize.mockResolvedValue({ organizationId: 'org', userId: 'reader', role: 'member' })
  mocks.store.mockResolvedValue([])
  featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(false)
})
it('persists an owned Search address after current organization authorization', async () => {
  const resource = createSearchResource({
    query: 'policy',
    scope: { kind: 'organization', organizationId: 'org' },
  })
  await changeChatResources.execute({
    principal,
    input: { chatId: 'chat', change: { kind: 'upsert', resources: [resource] } },
  })
  expect(mocks.authorize).toHaveBeenCalled()
  expect(mocks.store).toHaveBeenCalledWith('chat', { kind: 'upsert', resources: [resource] })
})
it.each(['upsert', 'reorder'] as const)(
  'rejects a forged foreign search owner in %s without storing metadata',
  async (kind) => {
    const resource = createSearchResource({
      query: 'policy',
      scope: { kind: 'organization', organizationId: 'other' },
    })
    await expect(
      changeChatResources.execute({
        principal,
        input: { chatId: 'chat', change: { kind, resources: [resource] } },
      })
    ).rejects.toThrow('Search resource scope must match its conversation')
    expect(mocks.store).not.toHaveBeenCalled()
  }
)
it('rechecks current membership before changing Search tabs', async () => {
  mocks.authorize.mockRejectedValueOnce(new Error('Membership revoked'))
  const resource = createSearchResource({
    query: 'policy',
    scope: { kind: 'organization', organizationId: 'org' },
  })
  await expect(
    changeChatResources.execute({
      principal,
      input: { chatId: 'chat', change: { kind: 'upsert', resources: [resource] } },
    })
  ).rejects.toThrow('Membership revoked')
  expect(mocks.store).not.toHaveBeenCalled()
})

const projectFile = {
  type: 'file' as const,
  id: 'file',
  title: 'notes.md',
  owner: { entityType: 'project' as const, entityId: 'project' },
}

it('refuses a new Project tab while Projects are off, without storing metadata', async () => {
  await expect(
    changeChatResources.execute({
      principal,
      input: { chatId: 'chat', change: { kind: 'upsert', resources: [projectFile] } },
    })
  ).rejects.toThrow('Projects are not enabled on this deployment')
  expect(mocks.store).not.toHaveBeenCalled()
})

it('stores a Project tab once Projects are on', async () => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async (flag) => flag === 'projects')
  await changeChatResources.execute({
    principal,
    input: { chatId: 'chat', change: { kind: 'upsert', resources: [projectFile] } },
  })
  expect(mocks.store).toHaveBeenCalledWith('chat', { kind: 'upsert', resources: [projectFile] })
})

it('removes a stored Project tab while Projects are off', async () => {
  await changeChatResources.execute({
    principal,
    input: { chatId: 'chat', change: { kind: 'remove', resources: [projectFile] } },
  })
  expect(mocks.store).toHaveBeenCalledWith('chat', { kind: 'remove', resources: [projectFile] })
})
