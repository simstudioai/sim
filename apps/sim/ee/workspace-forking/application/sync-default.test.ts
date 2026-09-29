/**
 * @vitest-environment node
 */
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import { resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import {
  workspaceAuthorizationMock,
  workspaceAuthorizationMockFns,
} from '@sim/testing/mocks/workspace-authorization.mock'
import { workspaceForkingAuthzMock } from '@sim/testing/mocks/workspace-forking-authz.mock'
import { workspaceForkingLineageMock } from '@sim/testing/mocks/workspace-forking-lineage.mock'
import {
  workspaceForkingLineageRootMock,
  workspaceForkingLineageRootMockFns,
} from '@sim/testing/mocks/workspace-forking-lineage-root.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveForkLineageRootId, mockResolveForkLineageWorkspaceIds } =
  workspaceForkingLineageRootMockFns

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/core/application/workspace-authorization', () => workspaceAuthorizationMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => workspaceForkingAuthzMock)
vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => workspaceForkingLineageMock)
vi.mock('@/ee/workspace-forking/lib/lineage/lineage-root', () => workspaceForkingLineageRootMock)

import { setForkSyncDefault } from '@/ee/workspace-forking/application/sync-default'

const principal = createSessionPrincipal({ userId: 'actor-1' })

beforeEach(() => {
  resetDbChainMock()
  permissionsMockFns.mockGetWorkspaceWithOwner.mockResolvedValue({
    id: 'fork-a',
    name: 'Fork A',
    organizationId: null,
    allowPersonalApiKeys: true,
  })
  workspaceAuthorizationMockFns.mockAuthorizeWorkspaceOperation.mockResolvedValue(undefined)
  mockResolveForkLineageRootId.mockResolvedValue('root-ws')
})

/**
 * The lineage-wide write and its audit fan-out are proven against real Postgres in
 * `fork-sync.integration.ts`. This covers the one branch that suite cannot stage: an unlink
 * committing between the root walk and the lineage lock.
 */
describe('setForkSyncDefault', () => {
  it('refuses when the locked root no longer reaches the calling workspace', async () => {
    mockResolveForkLineageWorkspaceIds.mockResolvedValue(['root-ws', 'fork-b'])
    await expect(
      setForkSyncDefault.execute({
        principal,
        input: { workspaceId: 'fork-a', excludeNewWorkflows: true },
      })
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})
