/**
 * @vitest-environment node
 */
import { dbChainMockFns, hasMockCondition, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getUpgradeWorkspaceId } from '@/lib/billing/core/payer-context'

describe('getUpgradeWorkspaceId', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('uses the billed account identity for personal payer workspaces', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'workspace-1' }])

    await expect(getUpgradeWorkspaceId({ type: 'user', id: 'payer-1' })).resolves.toBe(
      'workspace-1'
    )

    const predicate = dbChainMockFns.where.mock.calls.at(-1)?.[0]
    expect(
      hasMockCondition(
        predicate,
        (node) =>
          node.type === 'eq' &&
          node.left === schemaMock.workspace.billedAccountUserId &&
          node.right === 'payer-1'
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        predicate,
        (node) => node.type === 'eq' && node.left === schemaMock.workspace.ownerId
      )
    ).toBe(false)
    expect(
      hasMockCondition(
        predicate,
        (node) => node.type === 'isNull' && node.column === schemaMock.workspace.organizationId
      )
    ).toBe(true)
  })

  it('scopes organization payer workspaces by organization id', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(
      getUpgradeWorkspaceId({ type: 'organization', id: 'organization-1' })
    ).resolves.toBeNull()

    const predicate = dbChainMockFns.where.mock.calls.at(-1)?.[0]
    expect(
      hasMockCondition(
        predicate,
        (node) =>
          node.type === 'eq' &&
          node.left === schemaMock.workspace.organizationId &&
          node.right === 'organization-1'
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        predicate,
        (node) => node.type === 'eq' && node.left === schemaMock.workspace.billedAccountUserId
      )
    ).toBe(false)
  })
})
