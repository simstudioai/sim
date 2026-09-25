/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  inventory: vi.fn(),
  policies: vi.fn(),
  secrets: vi.fn(),
  saveSecrets: vi.fn(),
  connect: vi.fn(),
  reconnect: vi.fn(),
  refetch: vi.fn(),
}))
vi.mock('@/hooks/queries/organization-accounts', () => ({
  useOrganizationAccounts: mocks.inventory,
  useConnectOrganizationAccount: () => ({ mutate: mocks.connect }),
  useReconnectPersonalOrganizationAccount: () => ({ mutate: mocks.reconnect }),
}))
vi.mock('@/hooks/queries/organization-secrets', () => ({
  useOrganizationSecretSource: mocks.secrets,
  useConfigureOrganizationSecretSource: () => ({ mutate: mocks.saveSecrets }),
  useRemoveOrganizationSecretSource: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/hooks/queries/search-integrations', () => ({ useSearchIntegrations: mocks.policies }))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: () => ({ organization: { id: 'org', name: 'Example Organization' } }),
}))
vi.mock('@/app/o/[organizationId]/integrations/disconnect-account-menu', () => ({
  DisconnectAccountMenu: ({ accounts }: { accounts: { displayName: string }[] }) => (
    <span>{accounts.map((account) => account.displayName).join(', ')}</span>
  ),
}))
vi.mock('@/app/workspace/[workspaceId]/integrations/components/integrations-showcase', () => ({
  IntegrationTile: () => null,
}))

import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
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
  mocks.secrets.mockReturnValue({ data: { source: null } })
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
  it.each(['organization', 'member'] as const)(
    'shows Generic Secrets in %s mode without OAuth sources',
    async (mode) => {
      mocks.policies.mockReturnValue({ data: [] })
      mocks.inventory.mockReturnValue({ data: inventory({ credentialGroup: null }) })
      mocks.secrets.mockReturnValue({ data: { source: { id: 'source', mode } } })
      await render()
      expect(container.textContent).toContain('Generic Secrets')
      if (mode === 'member')
        expect(container.querySelector('a')?.getAttribute('href')).toBe(
          '/o/org/integrations/secrets'
        )
      else {
        expect(container.textContent).toContain('Organization managed')
        expect(container.querySelector('a')).toBeNull()
      }
      expect(button('Configure')).toBeUndefined()
      expect(button('Connect')).toBeUndefined()
      await render('unrelated')
      expect(container.textContent).not.toContain('Generic Secrets')
    }
  )
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
  ])('disables connection when %s', async (_name, overrides) => {
    mocks.inventory.mockReturnValue({ data: inventory(overrides) })
    await render()
    expect(button('Connect')?.disabled).toBe(true)
    await act(async () => button('Connect')!.click())
    expect(mocks.connect).not.toHaveBeenCalled()
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
  it.each([false, true])(
    'keeps Slack app setup out of member Integrations, admin=%s',
    async (canManage) => {
      mocks.policies.mockReturnValue({ data: [{ connectorType: 'slack', approved: true }] })
      mocks.inventory.mockReturnValue({ data: inventory({ canManage }) })
      await render()
      expect(container.textContent).toContain('Slack')
      expect(container.textContent).toContain('Not configured')
      expect(container.textContent).not.toContain('Finish setup')
      expect(container.querySelector('a')).toBeNull()
      expect(button('Connect')?.disabled).toBe(true)
      await act(async () => button('Connect')!.click())
      expect(mocks.connect).not.toHaveBeenCalled()
    }
  )
  it('explains service-account scope without hiding member connection controls', async () => {
    mocks.policies.mockReturnValue({
      data: [
        {
          connectorType: 'github',
          approved: true,
          policy: {
            ...defaultLiveSearchPolicy(),
            accessMode: 'service_account',
            sourceId: 'source',
          },
        },
      ],
    })
    mocks.inventory.mockReturnValue({
      data: inventory({
        viewerAccounts: [
          {
            credentialId: 'own',
            providerId: 'github-repositories',
            displayName: 'reader',
            status: 'active',
          },
        ],
      }),
    })
    await render()
    expect(container.textContent).toContain('Selected resources you can access')
    expect(button('Add account')).toBeDefined()
  })
})
