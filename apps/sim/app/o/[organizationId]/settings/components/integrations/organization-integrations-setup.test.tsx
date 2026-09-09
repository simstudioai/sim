/** @vitest-environment jsdom */
import { act } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrganizationSearchProviderSummary } from '@/lib/api/contracts/knowledge/connectors'

const mocks = vi.hoisted(() => ({
  admin: true,
  overview: vi.fn(),
  push: vi.fn(),
  add: vi.fn(),
  refetch: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => '/o/org-one/settings/integrations',
}))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: () => ({
    organization: { id: 'org-one' },
    viewer: { isAdmin: mocks.admin },
    searchAccess: { memberScoped: true, sourceMirrored: true },
  }),
}))
vi.mock('@/hooks/queries/kb/connectors', () => ({ useOrganizationSearchOverview: mocks.overview }))
vi.mock('@/hooks/queries/search-integrations', () => ({
  useUpdateSearchIntegration: () => ({ mutate: mocks.add, isPending: false }),
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({
    integrationAvailability: new Map(),
    oauthServiceAvailability: new Map([
      ['confluence', true],
      ['google-drive', true],
    ]),
    isIntegrationAvailabilityReady: true,
  }),
}))
vi.mock('@/app/workspace/[workspaceId]/search/components/search-source-setup', () => ({
  SearchSourceSetup: () => null,
}))
vi.mock('@/app/o/[organizationId]/settings/components/integrations/slack-account-setup', () => ({
  OrganizationSlackAccountSetup: () => null,
}))

import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { OrganizationIntegrationsSetup } from '@/app/o/[organizationId]/settings/components/integrations/organization-integrations-setup'

const providers: OrganizationSearchProviderSummary[] = [
  {
    connectorType: 'gmail',
    approved: true,
    sourceCount: 0,
    status: 'waiting_for_connections',
    isSyncing: false,
  },
  { connectorType: 'google_drive', approved: false, sourceCount: 2, status: 'paused' },
]
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  mocks.admin = true
  mocks.overview.mockReturnValue({ data: { providers }, isPending: false, refetch: mocks.refetch })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function render(searchParams = '') {
  await act(async () =>
    root.render(
      <NuqsTestingAdapter hasMemory searchParams={searchParams}>
        <SettingsHeaderProvider>
          <SettingsHeaderShell>
            <OrganizationIntegrationsSetup />
          </SettingsHeaderShell>
        </SettingsHeaderProvider>
      </NuqsTestingAdapter>
    )
  )
}
async function click(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label
  )
  expect(button, `Missing ${label}`).toBeTruthy()
  await act(async () => button!.click())
}

describe('organization integration management entry', () => {
  it('lists added integrations with stable detail links including deactivated providers', async () => {
    await render()
    expect(document.querySelector('a[aria-label="Manage Gmail"]')).toHaveAttribute(
      'href',
      '/o/org-one/settings/integrations/providers/gmail'
    )
    expect(document.querySelector('a[aria-label="Manage Google Drive"]')).toHaveAttribute(
      'href',
      '/o/org-one/settings/integrations/providers/google_drive'
    )
    expect(container.textContent).toContain('Waiting for account connections')
    expect(container.textContent).toContain('Deactivated')
    expect(container.textContent).not.toContain('Confluence')
    expect(document.querySelector('[role="switch"]')).toBeNull()
  })
  it('shows an intentional empty state and an Add integration header action', async () => {
    mocks.overview.mockReturnValue({ data: { providers: [] }, isPending: false })
    await render()
    expect(container.textContent).toContain('Add an integration to get started.')
    await click('Add integration')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })
  it('adds a provider once and goes to its management page', async () => {
    mocks.add.mockImplementation((_input, options) => options.onSuccess())
    await render()
    await click('Add integration')
    expect(document.querySelector('button[aria-label="Add Gmail"]')).toBeNull()
    await click('Add Confluence')
    expect(mocks.add).toHaveBeenCalledWith(
      { organizationId: 'org-one', connectorType: 'confluence', approved: true },
      expect.any(Object)
    )
    expect(mocks.push).toHaveBeenCalledWith('/o/org-one/settings/integrations/providers/confluence')
  })
  it('does not turn a failed summary into an empty setup state', async () => {
    mocks.overview.mockReturnValue({
      error: new Error('Could not load sources'),
      isError: true,
      refetch: mocks.refetch,
    })
    await render()
    expect(container.textContent).not.toContain('Add an integration to get started.')
    expect(document.querySelector('a[aria-label="Manage Gmail"]')).toBeNull()
    await click('Try again')
    expect(mocks.refetch).toHaveBeenCalledOnce()
  })
  it('keeps loading distinct from empty and disables creation', async () => {
    mocks.overview.mockReturnValue({ isPending: true })
    await render()
    expect(container.textContent).toContain('Loading sources')
    await click('Add integration')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it('does not expose admin controls or load admin data for members', async () => {
    mocks.admin = false
    await render()
    expect(mocks.overview).toHaveBeenLastCalledWith('org-one', { enabled: false })
    expect(container.textContent).toBe('')
  })
  it('filters added integration names without dropping server summary context', async () => {
    await render('?search=gmail')
    expect(document.querySelector('a[aria-label="Manage Gmail"]')).not.toBeNull()
    expect(document.querySelector('a[aria-label="Manage Google Drive"]')).toBeNull()
  })
})
