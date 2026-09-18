/** @vitest-environment node */
import type { Principal, SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  lock: vi.fn(),
  audit: vi.fn(),
  outbound: vi.fn(),
}))
vi.mock('@/ee/access-requests/lib/application/authorization', () => ({
  authorizeAccessRequestScope: mocks.authorize,
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: mocks.lock,
}))
vi.mock('@/lib/core/application/authorized-workspace-use-case', () => ({
  recordProjectedUseCaseAuditEntries: mocks.audit,
}))
vi.mock('@/lib/core/network/context.server', () => ({
  runWithOutboundOrganization: mocks.outbound,
}))

import type { AccessRequestScope } from '@/lib/api/contracts/access-requests'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { defineAuthorizedAccessRequestUseCase } from '@/ee/access-requests/lib/application/authorized-use-case'
import { accessRequestOperations } from '@/ee/access-requests/lib/application/operations'

const principal: SessionPrincipal = { kind: 'session', userId: 'requester', sessionId: 'session' }
const scope: AccessRequestScope = { kind: 'workspace', workspaceId: 'workspace' }
const context = {
  organizationId: 'org',
  workspaceId: 'workspace',
  membershipId: '["member","grant"]',
  role: 'read',
}
const transaction = { select: vi.fn() } as unknown as DbOrTx
const input = { workspaceId: 'workspace' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorize.mockResolvedValue(context)
  mocks.lock.mockResolvedValue(undefined)
  mocks.outbound.mockImplementation((_organizationId: string, run: () => Promise<unknown>) => run())
  vi.mocked(db.transaction).mockImplementation(async (run) => run(transaction as never))
})

describe('authorized access request execution', () => {
  it.each<Principal>([
    { kind: 'personal_api_key', userId: 'owner', keyId: 'key' },
    { kind: 'workspace_api_key', workspaceId: 'workspace', keyId: 'key' },
    {
      kind: 'oauth_access_token',
      userId: 'owner',
      tokenId: 'token',
      clientId: 'client',
      scopes: ['api:write'],
      expiresAt: new Date('2099-01-01'),
    },
  ])('refuses $kind before scope lookup or preparation', async (caller) => {
    const prepare = vi.fn().mockResolvedValue({ ready: true })
    const execute = vi.fn()
    const getScope = vi.fn().mockReturnValue(scope)
    const useCase = defineAuthorizedAccessRequestUseCase({
      operation: accessRequestOperations.create,
      scope: getScope,
      prepare,
      execute,
    })
    await expect(useCase.execute({ principal: caller, input })).rejects.toThrow('signed-in user')
    expect(getScope).not.toHaveBeenCalled()
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not prepare or execute when the initial authorization fails', async () => {
    mocks.authorize.mockRejectedValue(new OrchestrationError('not_found', 'Workspace not found'))
    const prepare = vi.fn()
    const execute = vi.fn()
    const useCase = defineAuthorizedAccessRequestUseCase({
      operation: accessRequestOperations.create,
      scope: () => scope,
      mutation: true,
      prepare,
      execute,
    })
    await expect(useCase.execute({ principal, input })).rejects.toThrow('Workspace not found')
    expect(prepare).not.toHaveBeenCalled()
    expect(db.transaction).not.toHaveBeenCalled()
  })

  it('prepares outside locks, then rechecks the original scope and incarnation before mutating', async () => {
    const prepared = { catalog: ['governed-item'] }
    const prepare = vi.fn().mockResolvedValue(prepared)
    const execute = vi.fn().mockResolvedValue({ id: 'request' })
    const useCase = defineAuthorizedAccessRequestUseCase({
      operation: accessRequestOperations.create,
      scope: () => scope,
      mutation: true,
      prepare,
      execute,
    })
    await expect(useCase.execute({ principal, input })).resolves.toEqual({ id: 'request' })
    expect(prepare).toHaveBeenCalledExactlyOnceWith({ principal, input, context })
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(db.transaction).mock.invocationCallOrder[0]
    )
    expect(mocks.lock).toHaveBeenCalledExactlyOnceWith(transaction, 'org')
    expect(mocks.authorize).toHaveBeenNthCalledWith(
      2,
      principal,
      accessRequestOperations.create,
      scope,
      transaction,
      true,
      context
    )
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.authorize.mock.invocationCallOrder[1]
    )
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      principal,
      input,
      context,
      executor: transaction,
      prepared,
    })
  })

  it('never executes or audits after membership is removed during preparation', async () => {
    mocks.authorize
      .mockResolvedValueOnce(context)
      .mockRejectedValueOnce(new OrchestrationError('not_found', 'Access request scope not found'))
    const execute = vi.fn()
    const projectAudit = vi.fn().mockReturnValue([])
    const useCase = defineAuthorizedAccessRequestUseCase({
      operation: accessRequestOperations.create,
      scope: () => scope,
      mutation: true,
      prepare: async () => true,
      execute,
      projectAudit,
    })
    await expect(useCase.execute({ principal, input })).rejects.toThrow(
      'Access request scope not found'
    )
    expect(execute).not.toHaveBeenCalled()
    expect(projectAudit).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('does not acquire locks when preparation fails', async () => {
    const execute = vi.fn()
    const useCase = defineAuthorizedAccessRequestUseCase({
      operation: accessRequestOperations.create,
      scope: () => scope,
      mutation: true,
      prepare: async () => {
        throw new Error('Catalog unavailable')
      },
      execute,
    })
    await expect(useCase.execute({ principal, input })).rejects.toThrow('Catalog unavailable')
    expect(db.transaction).not.toHaveBeenCalled()
    expect(mocks.lock).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('supports authorization-only probes without preparing or running business behavior', async () => {
    const prepare = vi.fn()
    const execute = vi.fn()
    const useCase = defineAuthorizedAccessRequestUseCase({
      operation: accessRequestOperations.listMine,
      scope: () => scope,
      prepare,
      execute,
    })
    await useCase.authorize?.({ principal, input })
    expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith(
      principal,
      accessRequestOperations.listMine,
      scope
    )
    expect(prepare).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('keeps the acting session principal for reads and audits', async () => {
    const execute = vi.fn().mockResolvedValue('result')
    const projectAudit = vi.fn().mockReturnValue([])
    const useCase = defineAuthorizedAccessRequestUseCase({
      operation: accessRequestOperations.listMine,
      scope: () => scope,
      execute,
      projectAudit,
    })
    await useCase.execute({ principal, input })
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      principal,
      input,
      context,
      executor: db,
      prepared: undefined,
    })
    expect(mocks.outbound).toHaveBeenCalledWith('org', expect.any(Function))
    expect(mocks.audit).toHaveBeenCalledWith(
      accessRequestOperations.listMine,
      'workspace',
      principal,
      undefined,
      [],
      'org'
    )
    expect(db.transaction).not.toHaveBeenCalled()
  })
})
