/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  inventory: vi.fn(),
  policies: vi.fn(),
  connect: vi.fn(),
  reconnect: vi.fn(),
  refetch: vi.fn(),
}))
vi.mock('@/hooks/queries/organization-accounts', () => ({
  useOrganizationAccounts: mocks.inventory,
  useConnectOrganizationAccount: () => ({ mutate: mocks.connect }),
  useReconnectPersonalOrganizationAccount: () => ({ mutate: mocks.reconnect }),
}))
vi.mock('@/hooks/queries/search-integrations', () => ({ useSearchIntegrations: mocks.policies }))
vi.mock('@/app/o/[organizationId]/integrations/disconnect-account-menu', () => ({
  DisconnectAccountMenu: ({ accounts }: { accounts: { displayName: string }[] }) => (
    <span>{accounts.map((account) => account.displayName).join(', ')}</span>
  ),
}))
vi.mock('@/app/workspace/[workspaceId]/integrations/components/integrations-showcase', () => ({
  IntegrationTile: () => null,
}))

import { LiveMemberIntegrations } from '@/app/o/[organizationId]/integrations/live-member-integrations'

let root: Root
let container: HTMLDivElement
const group = {
  status: 'active',
  options: [
    {
      id: 'github-option',
      provider: 'github-repositories',
      status: 'active',
      configurationStatus: 'ready',
    },
  ],
  mcpServers: [],
}
const inventory = (overrides = {}) => ({
  credentialGroup: group,
  viewerAccounts: [],
  viewerMcpAccounts: [],
  canManage: false,
  ...overrides,
})
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.inventory.mockReturnValue({ data: inventory(), refetch: mocks.refetch })
  mocks.policies.mockReturnValue({
    data: [{ connectorType: 'github', approved: true }],
    refetch: mocks.refetch,
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
const render = async (search = '') => {
  await act(async () =>
    root.render(<LiveMemberIntegrations organizationId='org' search={search} />)
  )
}
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((button) => button.textContent === label)
describe('live member connection states', () => {
  it('keeps GitLab organization-managed with no personal token or connect action', async () => {
    mocks.policies.mockReturnValue({ data: [{ connectorType: 'gitlab', approved: true }] })
    await render()
    expect(container.textContent).toContain('Organization managed')
    expect(container.textContent).not.toContain('personal access token')
    expect(button('Connect')).toBeUndefined()
  })
  it('connects the active provider option in this organization', async () => {
    await render()
    await act(async () => button('Connect')!.click())
    expect(mocks.connect).toHaveBeenCalledWith(
      { organizationId: 'org', optionId: 'github-option' },
      expect.any(Object)
    )
  })
  it.each([
    ['disabled', { credentialGroup: { ...group, status: 'disabled' } }],
    ['unconfigured', { credentialGroup: null }],
  ])('does not offer a connection when %s', async (_name, overrides) => {
    mocks.inventory.mockReturnValue({ data: inventory(overrides) })
    await render()
    expect(button('Connect')).toBeUndefined()
  })
  it('shows the current account and reconnect action without enabling a disabled integration', async () => {
    mocks.inventory.mockReturnValue({
      data: inventory({
        viewerAccounts: [
          {
            credentialId: 'own',
            providerId: 'github-repositories',
            displayName: 'reader',
            status: 'needs_reauth',
          },
        ],
      }),
    })
    await render()
    await act(async () => button('Reconnect')!.click())
    expect(mocks.reconnect).toHaveBeenCalledWith('own', expect.any(Object))
    mocks.policies.mockReturnValue({ data: [{ connectorType: 'github', approved: false }] })
    await render()
    expect(button('Reconnect')?.disabled).toBe(true)
    expect(button('Add account')).toBeUndefined()
  })
  it('never presents another MCP provider as a Coda connection', async () => {
    mocks.policies.mockReturnValue({ data: [{ connectorType: 'coda', approved: true }] })
    mocks.inventory.mockReturnValue({
      data: inventory({
        credentialGroup: {
          ...group,
          mcpServers: [{ id: 'coda-server', managedConnectorId: 'coda', enabled: true }],
        },
        viewerMcpAccounts: [
          {
            credentialId: 'other',
            mcpServerId: 'other-server',
            displayName: 'Other private account',
            status: 'active',
          },
        ],
      }),
    })
    await render()
    expect(container.textContent).not.toContain('Other private account')
    await act(async () => button('Connect')!.click())
    expect(mocks.connect).toHaveBeenCalledWith(
      { organizationId: 'org', mcpServerId: 'coda-server' },
      expect.any(Object)
    )
  })
  it('distinguishes filtered empty, loading, and failed states', async () => {
    await render('nothing')
    expect(container.textContent).toContain('No integrations match')
    mocks.inventory.mockReturnValue({})
    await render()
    expect(container.textContent).toContain('Loading your connections')
    mocks.inventory.mockReturnValue({
      error: new Error('Network unavailable'),
      refetch: mocks.refetch,
    })
    await render()
    expect(container.textContent).toContain('Network unavailable')
  })
})
