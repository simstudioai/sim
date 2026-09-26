import { copilotChats, member } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

import { executeOrganizationSecretUseCase } from '@/lib/mothership/application/execute-organization-secret-use-case'
import { organizationSecretOperations } from '@/lib/organization-secrets/application/operations'

const mocks = {
  config: permissionGroupsResolveMockFns.mockGetUserPermissionConfigForOrganization,
  execute: vi.fn(),
}

const context = {
  userId: 'actor',
  organizationId: 'org',
  chatId: 'chat',
  toolCallId: 'call',
  copilotToolExecution: true,
  requestMode: 'agent',
}
const useCase = { operation: organizationSecretOperations.mount, execute: mocks.execute }
beforeEach(() => {
  vi.resetAllMocks()
  resetDbChainMock()
  mocks.config.mockResolvedValue(null)
  queueTableRows(member, [{ role: 'admin' }])
  queueTableRows(copilotChats, [{ id: 'chat' }])
})
describe('Build and Plan Generic Secrets delegation', () => {
  it.each(['agent', 'plan'])(
    'binds the actor, chat, and organization for %s before entering the registered operation',
    async (requestMode) => {
      await executeOrganizationSecretUseCase({ ...context, requestMode }, useCase, {
        names: ['TOKEN'],
        organizationId: 'forged',
      } as never)
      expect(mocks.execute).toHaveBeenCalledWith({
        principal: expect.objectContaining({
          subjectUserId: 'actor',
          organizationId: 'org',
          audience: 'sim:organization-secrets',
          resourceScope: { chatId: 'chat' },
        }),
        input: { names: ['TOKEN'], organizationId: 'org' },
      })
      expect(dbChainMockFns.from).toHaveBeenCalledWith(copilotChats)
      expect(dbChainMockFns.where).toHaveBeenCalledWith(
        expect.objectContaining({
          conditions: expect.arrayContaining([
            { type: 'eq', left: copilotChats.organizationId, right: 'org' },
            { type: 'eq', left: copilotChats.userId, right: 'actor' },
            { type: 'isNull', column: copilotChats.deletedAt },
          ]),
        })
      )
    }
  )
  it.each([
    { requestMode: 'assistant' },
    { requestMode: undefined },
    { requestMode: 'build' },
    { copilotToolExecution: false },
    { userId: '' },
    { toolCallId: '' },
    { chatId: '' },
    { workspaceId: 'workspace' },
    { workflowId: 'workflow' },
  ])('rejects an invalid execution context %j', async (change) => {
    await expect(
      executeOrganizationSecretUseCase({ ...context, ...change }, useCase, { names: ['TOKEN'] })
    ).rejects.toThrow()
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('rejects removed or foreign chats before resolving secrets', async () => {
    resetDbChainMock()
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(copilotChats, [])
    await expect(
      executeOrganizationSecretUseCase(context, useCase, { names: ['TOKEN'] })
    ).rejects.toThrow('Conversation not found')
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it.each(['agent', 'plan'])(
    'rechecks Build permission before mounting in %s',
    async (requestMode) => {
      mocks.config.mockResolvedValue({ disableWorkspaceCreation: true })
      await expect(
        executeOrganizationSecretUseCase({ ...context, requestMode }, useCase, { names: ['TOKEN'] })
      ).rejects.toThrow('Build requires permission')
      expect(mocks.execute).not.toHaveBeenCalled()
    }
  )
  it('rejects a copied operation even with the same ID', async () => {
    await expect(
      executeOrganizationSecretUseCase(
        context,
        { ...useCase, operation: { ...useCase.operation } },
        {}
      )
    ).rejects.toThrow('Unregistered')
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
