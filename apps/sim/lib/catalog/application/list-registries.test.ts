import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@sim/audit', () => auditMock)

import { listCatalogConnectorTypes } from '@/lib/catalog/application/list-connector-types'

const mocks = {
  loadWorkspace: workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const WORKSPACE_ID = 'workspace-1'
const session = createSessionPrincipal()

describe('connector-type catalog', () => {
  beforeEach(() => {
    mocks.loadWorkspace.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.resolvePermission.mockResolvedValue('read')
  })

  const fullPage = { detail: 'full' as const, limit: 100, offset: 0 }

  it('publishes the multi and canonical-pair config properties a caller cannot infer', async () => {
    const { entries } = await listCatalogConnectorTypes.execute({
      principal: session,
      input: { workspaceId: WORKSPACE_ID, ...fullPage },
    })

    const fields = entries.flatMap((entry) => ('configFields' in entry ? entry.configFields : []))
    expect(fields.length).toBeGreaterThan(0)
    expect(fields.some((field) => field.multi === true)).toBe(true)
    expect(fields.some((field) => typeof field.canonicalParamId === 'string')).toBe(true)
    expect(fields.every((field) => !Object.hasOwn(field, 'icon'))).toBe(true)
  })

  it('answers not found for a workspace the caller cannot reach', async () => {
    mocks.loadWorkspace.mockResolvedValue(null)

    await expect(
      listCatalogConnectorTypes.execute({
        principal: session,
        input: { workspaceId: WORKSPACE_ID, ...fullPage },
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Workspace not found' })
  })
})
