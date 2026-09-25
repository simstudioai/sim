import type { SessionPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  listCatalog: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/credentials/application/provider-catalog', () => ({
  listCredentialProviderCatalog: mocks.listCatalog,
}))

import { listCredentialProviders } from '@/lib/credentials/application/list-credential-providers'

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
    const principal: SessionPrincipal = {
      kind: 'session',
      userId: 'user-1',
      sessionId: 'session-1',
    }

    const result = await listCredentialProviders.execute({
      principal,
      input: { workspaceId: 'workspace-1', search: 'SaLeS' },
    })

    expect(result.providers).toEqual([salesforce])
  })
})
