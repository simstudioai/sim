/** @vitest-environment node */
import { db } from '@sim/db'
import { workspace, workspaceEnvironment } from '@sim/db/schema'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import {
  workspaceAuthorizationMock,
  workspaceAuthorizationMockFns,
} from '@sim/testing/mocks/workspace-authorization.mock'
import { workspaceForkingAuthzMock } from '@sim/testing/mocks/workspace-forking-authz.mock'
import {
  workspaceForkingLineageMock,
  workspaceForkingLineageMockFns,
} from '@sim/testing/mocks/workspace-forking-lineage.mock'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  credentials: vi.fn(),
  invalidate: vi.fn(),
  overlay: vi.fn(),
}))
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/core/application/workspace-authorization', () => workspaceAuthorizationMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => workspaceForkingAuthzMock)
vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => workspaceForkingLineageMock)
vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret: async () => ({ encrypted: 'ciphertext' }),
}))
vi.mock('@/lib/credentials/env-locks', () => ({ lockWorkspaceEnvMap: vi.fn() }))
vi.mock('@/lib/credentials/environment', () => ({
  createWorkspaceEnvCredentials: mocks.credentials,
}))
vi.mock('@/lib/environment/utils', () => ({
  invalidateEffectiveDecryptedEnvCache: mocks.invalidate,
}))
vi.mock('@/lib/workflows/references/resources', () => ({
  getWorkspaceEnvKeys: async () => new Set(['SOURCE']),
}))
vi.mock('@/ee/workspace-forking/lib/mapping/mapping-store', () => ({
  getEdgeMappingRows: async () => [],
}))
vi.mock('@/ee/workspace-forking/lib/mapping/mapping-service', () => ({
  applyForkMappingEntries: mocks.apply,
  overlayForkMappingEntries: mocks.overlay,
}))

import { createWorkspaceForkSecretMapping } from '@/ee/workspace-forking/application/create-secret-mapping'

const principal = createSessionPrincipal({ userId: 'actor' })
const input = {
  workspaceId: 'child',
  otherWorkspaceId: 'parent',
  direction: 'push' as const,
  sourceId: 'SOURCE',
  name: 'NEW_TOKEN',
  value: 'test-only-value',
}
beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  permissionsMockFns.mockGetWorkspaceWithOwner.mockImplementation(async (id: string) => ({
    id,
    organizationId: null,
    allowPersonalApiKeys: true,
  }))
  workspaceAuthorizationMockFns.mockAuthorizeWorkspaceOperation.mockResolvedValue(undefined)
  workspaceForkingLineageMockFns.mockResolveForkEdge.mockResolvedValue({
    childWorkspaceId: 'child',
    parentWorkspaceId: 'parent',
  })
  queueTableRows(workspace, [{ parentId: 'parent' }])
  mocks.apply.mockResolvedValue(1)
})
it('creates credential and mapping using the same transaction and audits without the value', async () => {
  queueTableRows(workspaceEnvironment, [{ variables: { OTHER: 'existing-cipher' } }])
  await expect(createWorkspaceForkSecretMapping.execute({ principal, input })).resolves.toEqual({
    name: 'NEW_TOKEN',
    targetWorkspaceId: 'parent',
  })
  expect(db.transaction).toHaveBeenCalledTimes(1)
  expect(mocks.credentials).toHaveBeenCalledWith(
    expect.objectContaining({
      workspaceId: 'parent',
      newKeys: ['NEW_TOKEN'],
      actingUserId: 'actor',
    })
  )
  expect(mocks.apply.mock.calls[0][0]).toBe(mocks.credentials.mock.calls[0][0].executor)
  expect(JSON.stringify(auditMockFns.mockRecordAudit.mock.calls)).not.toContain('test-only-value')
  expect(mocks.invalidate).toHaveBeenCalledWith({ workspaceId: 'parent' })
})
it('rejects an existing name before writing or mapping', async () => {
  queueTableRows(workspaceEnvironment, [{ variables: { NEW_TOKEN: 'existing-cipher' } }])
  await expect(createWorkspaceForkSecretMapping.execute({ principal, input })).rejects.toThrow(
    'already exists'
  )
  expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  expect(mocks.apply).not.toHaveBeenCalled()
})
it('does not publish success effects if mapping fails', async () => {
  queueTableRows(workspaceEnvironment, [])
  mocks.apply.mockRejectedValueOnce(new Error('mapping failed'))
  await expect(createWorkspaceForkSecretMapping.execute({ principal, input })).rejects.toThrow(
    'mapping failed'
  )
  expect(mocks.invalidate).not.toHaveBeenCalled()
  expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
})
