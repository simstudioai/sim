import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  listCatalog: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/credentials/application/provider-catalog', () => ({
  listCredentialProviderCatalog: hoisted.listCatalog,
}))

import { listCredentialProviders } from '@/lib/credentials/application/list-credential-providers'

const mocks = {
  ...hoisted,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  loadWorkspace: workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext,
}

const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

describe('listCredentialProviders', () => {
  beforeEach(() => {
    mocks.loadWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.listCatalog.mockResolvedValue([])
  })

  it('searches provider names case-insensitively without matching ids or descriptions', async () => {
    const salesforce = {
      name: 'Salesforce',
      serviceId: 'salesforce',
      description: 'Connect a CRM.',
    }
    const google = {
      name: 'Google',
      serviceId: 'salesforce-migration',
      description: 'Migrate Salesforce records.',
    }
    mocks.listCatalog.mockResolvedValue([salesforce, google])
    const principal = createSessionPrincipal()

    const result = await listCredentialProviders.execute({
      principal,
      input: { workspaceId: 'workspace-1', search: 'SaLeS' },
    })

    expect(result.providers).toEqual([salesforce])
  })
})
