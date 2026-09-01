/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  compileCredentialGroupWorkflowAccessPolicy,
  credentialGroupWorkflowAccessPolicyCodec,
} from '@/lib/credential-groups/application/workflow-access-policy'
import {
  deleteResourcePolicyForResource,
  ResourcePolicyNotFoundError,
  ResourcePolicyRevisionConflictError,
  requireResourcePolicy,
  writeResourcePolicy,
} from '@/lib/resource-policies/repository'

const TARGET = {
  workspaceId: 'workspace-1',
  resourceType: 'credential_group' as const,
  resourceId: 'group-1',
  codec: credentialGroupWorkflowAccessPolicyCodec,
}
const DEFAULT_DOCUMENT = compileCredentialGroupWorkflowAccessPolicy({
  credentialGroupId: TARGET.resourceId,
  allowedWorkflowIds: [],
})

function storedRow(revision = 1, document: unknown = DEFAULT_DOCUMENT) {
  return {
    id: 'policy-1',
    workspaceId: TARGET.workspaceId,
    resourceType: TARGET.resourceType,
    resourceId: TARGET.resourceId,
    revision,
    document,
    createdBy: 'admin-1',
    updatedBy: 'admin-1',
    createdAt: new Date('2026-08-20T00:00:00.000Z'),
    updatedAt: new Date('2026-08-20T00:00:00.000Z'),
  }
}

describe('resource policy repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('requires the canonical workspace, resource type, and resource ID', async () => {
    queueTableRows(schemaMock.resourcePolicy, [storedRow()])

    await expect(requireResourcePolicy(TARGET)).resolves.toMatchObject({
      id: 'policy-1',
      workspaceId: TARGET.workspaceId,
      revision: 1,
      document: DEFAULT_DOCUMENT,
    })

    const where = dbChainMockFns.where.mock.calls.at(-1)?.[0]
    for (const expected of [TARGET.workspaceId, TARGET.resourceType, TARGET.resourceId]) {
      expect(
        hasMockCondition(
          where,
          (condition) => condition.type === 'eq' && condition.right === expected
        )
      ).toBe(true)
    }
  })

  it('fails fast for a missing or malformed stored policy', async () => {
    await expect(requireResourcePolicy(TARGET)).rejects.toBeInstanceOf(ResourcePolicyNotFoundError)

    queueTableRows(schemaMock.resourcePolicy, [storedRow(1, { version: 1 })])
    await expect(requireResourcePolicy(TARGET)).rejects.toThrow()
  })

  it('locks and advances exactly the expected revision', async () => {
    queueTableRows(schemaMock.resourcePolicy, [storedRow(3)])
    const updated = { ...storedRow(4), updatedAt: new Date('2026-08-20T01:00:00.000Z') }
    dbChainMockFns.returning.mockResolvedValueOnce([updated])

    await expect(
      writeResourcePolicy({
        ...TARGET,
        expectedRevision: 3,
        actorUserId: 'admin-2',
        document: DEFAULT_DOCUMENT,
      })
    ).resolves.toMatchObject({ revision: 4, document: DEFAULT_DOCUMENT })

    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 4, updatedBy: 'admin-2' })
    )
    const updateWhere = dbChainMockFns.where.mock.calls.at(-1)?.[0]
    expect(
      hasMockCondition(updateWhere, (condition) => condition.type === 'eq' && condition.right === 3)
    ).toBe(true)
  })

  it('rejects a stale revision without issuing an update', async () => {
    queueTableRows(schemaMock.resourcePolicy, [storedRow(4)])

    await expect(
      writeResourcePolicy({
        ...TARGET,
        expectedRevision: 3,
        actorUserId: 'admin-2',
        document: DEFAULT_DOCUMENT,
      })
    ).rejects.toBeInstanceOf(ResourcePolicyRevisionConflictError)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('requires exactly one policy row when deleting a resource', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'policy-1' }])
    await expect(deleteResourcePolicyForResource(TARGET, dbChainMock.db)).resolves.toBeUndefined()

    dbChainMockFns.returning.mockResolvedValueOnce([])
    await expect(deleteResourcePolicyForResource(TARGET, dbChainMock.db)).rejects.toBeInstanceOf(
      ResourcePolicyNotFoundError
    )
  })
})
