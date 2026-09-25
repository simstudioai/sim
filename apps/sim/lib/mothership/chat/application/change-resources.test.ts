import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), authorize: vi.fn(), store: vi.fn() }))
vi.mock('@/lib/mothership/chat/application/context', () => ({
  resolveOwnedChatContext: mocks.resolve,
}))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: mocks.authorize,
}))
vi.mock('@/lib/mothership/resources/store', () => ({ changeStoredChatResources: mocks.store }))

import { changeChatResources } from '@/lib/mothership/chat/application/change-resources'
import { createSearchResource } from '@/lib/mothership/resources/search'

const principal = { kind: 'session', userId: 'reader', sessionId: 'session' } as const
beforeEach(() => {
  mocks.resolve.mockResolvedValue({ organizationId: 'org', chatId: 'chat', userId: 'reader' })
  mocks.authorize.mockResolvedValue({ organizationId: 'org', userId: 'reader', role: 'member' })
  mocks.store.mockResolvedValue([])
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
