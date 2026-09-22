/** @vitest-environment jsdom */
import { act } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  admin: true,
  policies: vi.fn(),
  accounts: vi.fn(),
  ensure: vi.fn(),
  update: vi.fn(),
  save: vi.fn(),
  providers: vi.fn(),
  people: vi.fn(),
  refetch: vi.fn(),
}))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: () => ({ organization: { id: 'org' }, viewer: { isAdmin: mocks.admin } }),
}))
vi.mock('@/hooks/queries/organization-accounts', () => ({
  useOrganizationAccounts: mocks.accounts,
  useEnsureOrganizationAccounts: () => ({ mutate: mocks.ensure, reset: vi.fn() }),
  useUpdateOrganizationAccounts: () => ({ mutate: mocks.update }),
}))
vi.mock('@/hooks/queries/search-integrations', () => ({
  useSearchIntegrations: mocks.policies,
  useUpdateSearchIntegration: () => ({ mutate: mocks.save }),
}))
vi.mock('@/ee/credential-groups/components/organization-account-providers', () => ({
  OrganizationAccountProviders: (props: unknown) => {
    mocks.providers(props)
    return <span>Provider setup</span>
  },
}))
vi.mock('@/ee/credential-groups/components/organization-account-people', () => ({
  OrganizationAccountPeople: (props: unknown) => {
    mocks.people(props)
    return <span>People management</span>
  },
}))
vi.mock('@/app/workspace/[workspaceId]/integrations/components/integrations-showcase', () => ({
  IntegrationTile: () => null,
}))

import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import { LiveSearchPolicyModal } from '@/app/o/[organizationId]/settings/components/integrations/live-search-policy-modal'
import { LiveSearchSettings } from '@/app/o/[organizationId]/settings/components/integrations/live-search-settings'

let root: Root
let container: HTMLDivElement
const group = { id: 'group', status: 'active', options: [], mcpServers: [] }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.admin = true
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.policies.mockReturnValue({
    data: [{ connectorType: 'github', approved: true }],
    refetch: mocks.refetch,
  })
  mocks.accounts.mockReturnValue({
    data: {
      credentialGroup: group,
      availableProviders: ['github-repositories', 'google-drive', 'asana'],
    },
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
async function render(params = '') {
  await act(async () =>
    root.render(
      <NuqsTestingAdapter hasMemory searchParams={params}>
        <SettingsHeaderProvider>
          <SettingsHeaderShell>
            <LiveSearchSettings />
          </SettingsHeaderShell>
        </SettingsHeaderProvider>
      </NuqsTestingAdapter>
    )
  )
}
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((element) => element.textContent === label)
describe('live search administration', () => {
  it('renders only scope controls by default, without indexing metrics', async () => {
    await render()
    expect(container.textContent).toContain('1 integration enabled')
    expect(container.textContent).not.toContain('indexing')
    expect(mocks.providers).not.toHaveBeenCalled()
    expect(mocks.people).not.toHaveBeenCalled()
  })
  it('honors connection setup links and separates GitLab from personal OAuth setup', async () => {
    await render('?live-tab=connections')
    expect(
      document.querySelector('a[href="/o/org/settings/integrations/providers/gitlab"]')
    ).not.toBeNull()
    expect(mocks.providers).toHaveBeenCalledWith(
      expect.objectContaining({
        availableProviders: ['github-repositories', 'google-drive'],
        availableMcpConnectors: ['coda'],
      })
    )
    expect(container.textContent).not.toContain('personal access token')
  })
  it('offers account setup without requiring an indexed source', async () => {
    mocks.accounts.mockReturnValue({ data: { credentialGroup: null, availableProviders: [] } })
    await render('?live-tab=connections')
    await act(async () => button('Set up connections')!.click())
    expect(mocks.ensure).toHaveBeenCalledWith({ organizationId: 'org' })
  })
  it('can resume paused sign-in connections', async () => {
    mocks.accounts.mockReturnValue({
      data: { credentialGroup: { ...group, status: 'disabled' }, availableProviders: [] },
    })
    await render('?live-tab=connections')
    await act(async () => button('Resume connections')!.click())
    expect(mocks.update).toHaveBeenCalledWith(
      { organizationId: 'org', groupId: 'group', update: { status: 'active' } },
      expect.any(Object)
    )
  })
  it('prevents requesting member connections before any provider is configured', async () => {
    await render('?live-tab=people')
    expect(mocks.people).toHaveBeenCalledWith(expect.objectContaining({ requestDisabled: true }))
  })
  it('shows loading and recoverable query errors', async () => {
    mocks.accounts.mockReturnValue({})
    await render()
    expect(container.textContent).toContain('Loading search settings')
    mocks.accounts.mockReturnValue({
      error: new Error('Service unavailable'),
      refetch: mocks.refetch,
    })
    await render()
    expect(container.textContent).toContain('Service unavailable')
  })
  it('does not render admin controls for members', async () => {
    mocks.admin = false
    await render()
    expect(container.textContent).toBe('')
  })
  it('allows disabling an integration even when its draft selected scope is empty', async () => {
    await act(async () =>
      root.render(
        <LiveSearchPolicyModal
          organizationId='org'
          integration={{
            connectorType: 'github',
            approved: true,
            policy: { ...defaultLiveSearchPolicy(), mode: 'selected' },
          }}
          onClose={vi.fn()}
        />
      )
    )
    await act(async () => button('Disabled')!.click())
    await act(async () => button('Save settings')!.click())
    expect(mocks.save).toHaveBeenCalledWith(
      { organizationId: 'org', connectorType: 'github', approved: false, policy: undefined },
      expect.any(Object)
    )
  })
})
