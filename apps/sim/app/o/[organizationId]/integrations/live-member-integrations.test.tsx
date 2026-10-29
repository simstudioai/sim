/** @vitest-environment jsdom */
import { act } from 'react'
import {
  organizationAccountsQueriesMock,
  organizationAccountsQueriesMockFns,
} from '@sim/testing/mocks/organization-accounts-queries.mock'
import {
  organizationProviderMock,
  organizationProviderMockFns,
} from '@sim/testing/mocks/organization-provider.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import { LiveMemberIntegrations } from '@/app/o/[organizationId]/integrations/live-member-integrations'

const mocks = vi.hoisted(() => ({ connect: vi.fn() }))
vi.mock('@/hooks/queries/organization-accounts', () => organizationAccountsQueriesMock)
vi.mock('@/hooks/queries/organization-secrets', () => ({
  useOrganizationSecretSource: () => ({ data: { source: null } }),
}))
vi.mock('@/hooks/queries/search-integrations', () => ({
  useSearchIntegrations: () => ({
    data: [{ connectorType: 'coda', approved: true }],
    isSuccess: true,
  }),
}))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => organizationProviderMock)
vi.mock('@/app/o/[organizationId]/integrations/disconnect-account-menu', () => ({
  DisconnectAccountMenu: ({ accounts }: { accounts: { displayName: string }[] }) => (
    <span>{accounts.map((account) => account.displayName).join(', ')}</span>
  ),
}))
vi.mock('@/app/workspace/[workspaceId]/integrations/components/integrations-showcase', () => ({
  IntegrationTile: () => null,
}))

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  organizationAccountsQueriesMockFns.mockUseConnectOrganizationAccount.mockReturnValue({
    mutate: mocks.connect,
  })
  organizationProviderMockFns.mockUseOrganizationContext.mockReturnValue({
    organization: { id: 'org', name: 'Example Organization' },
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})
it('never presents another MCP provider as a Coda connection', async () => {
  const inventory = {
    credentialGroup: {
      id: 'group',
      workspaceId: null,
      organizationId: 'org',
      name: 'Organization accounts',
      description: null,
      status: 'active',
      options: [],
      mcpServers: [
        {
          id: 'coda-server',
          name: 'Coda',
          description: null,
          authType: 'oauth',
          managedConnectorId: 'coda',
          enabled: true,
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    availableProviders: [],
    assistantProviders: [],
    availableMcpConnectors: ['coda'],
    viewerAccounts: [],
    viewerMcpAccounts: [
      {
        credentialId: 'other',
        mcpServerId: 'other-server',
        displayName: 'Other private account',
        status: 'active',
      },
    ],
    canManage: false,
    indexingAvailable: true,
  } satisfies OrganizationAccountsSettings
  organizationAccountsQueriesMockFns.mockUseOrganizationAccounts.mockReturnValue({
    data: inventory,
  })
  await act(async () => root.render(<LiveMemberIntegrations organizationId='org' search='' />))
  expect(container.textContent).not.toContain('Other private account')
  const connect = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Connect'
  )
  if (!connect) throw new Error('Missing Coda connection control')
  await act(async () => connect.click())
  expect(mocks.connect).toHaveBeenCalledWith(
    { organizationId: 'org', mcpServerId: 'coda-server' },
    expect.any(Object)
  )
})
