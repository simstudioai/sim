/** @vitest-environment jsdom */
import { act } from 'react'
import { toast } from '@sim/emcn'
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
  availability: vi.fn(),
  reset: vi.fn(),
  pending: false,
  mutationError: null as Error | null,
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
  useUpdateSearchIntegration: () => ({
    mutate: mocks.add,
    isPending: mocks.pending,
    reset: mocks.reset,
    error: mocks.mutationError,
  }),
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: mocks.availability,
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
    issue: null,
    isSyncing: false,
  },
  {
    connectorType: 'google_drive',
    approved: false,
    sourceCount: 2,
    status: 'paused',
    issue: null,
    isSyncing: false,
  },
]
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  mocks.admin = true
  mocks.pending = false
  mocks.mutationError = null
  mocks.add.mockReset()
  vi.spyOn(toast, 'error').mockReturnValue('error-toast')
  mocks.availability.mockReturnValue({
    integrationAvailability: new Map(),
    oauthServiceAvailability: new Map([
      ['confluence', true],
      ['google-drive', true],
      ['google-email', true],
    ]),
    isIntegrationAvailabilityReady: true,
    refetchIntegrationAvailability: mocks.refetch,
  })
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
  vi.restoreAllMocks()
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
  it('uses Sources terminology in search and its empty state', async () => {
    await render('?search=not-a-real-source')
    expect(container.querySelector('input[placeholder="Search sources..."]')).toHaveValue(
      'not-a-real-source'
    )
    expect(container.textContent).toContain('No matching sources')
    expect(container.textContent).not.toContain('No matching integrations')
  })
  it('offers Drive account management before anyone has connected', async () => {
    mocks.overview.mockReturnValue({
      data: {
        providers: [
          {
            connectorType: 'google_drive',
            approved: true,
            sourceCount: 0,
            status: 'waiting_for_connections',
            issue: null,
            isSyncing: false,
          },
        ],
      },
      isPending: false,
    })
    await render()
    expect(document.querySelector('a[aria-label="Manage Google Drive"]')).toHaveAttribute(
      'href',
      '/o/org-one/settings/integrations/providers/google_drive'
    )
    expect(document.querySelector('a[aria-label="Set up Google Drive"]')).toBeNull()
    expect(container.textContent).toContain('Waiting for connections')
  })
  it('shows the stable catalog with switches and separate setup and management links', async () => {
    await render()
    expect(document.querySelector('a[aria-label="Manage Gmail"]')).toHaveAttribute(
      'href',
      '/o/org-one/settings/integrations/providers/gmail'
    )
    expect(document.querySelector('a[aria-label="Manage Google Drive"]')).toHaveAttribute(
      'href',
      '/o/org-one/settings/integrations/providers/google_drive'
    )
    expect(container.textContent).toContain('Waiting for connections')
    expect(container.textContent).not.toContain('Needs setup')
    expect(container.textContent).toContain('Disabled')
    expect(container.textContent).toContain('Confluence')
    expect(container.textContent).not.toContain('Add integration')
    expect(document.querySelector('[aria-label="Allow Gmail in Sim Search"]')).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(
      document.querySelector('[aria-label="Allow Google Drive in Sim Search"]')
    ).toHaveAttribute('aria-checked', 'false')
    expect(document.querySelector('a[aria-label="Set up Confluence"]')).toBeNull()
  })

  it('offers the catalog for a new organization without a modal or writes', async () => {
    mocks.overview.mockReturnValue({ data: { providers: [] }, isPending: false })
    await render()
    expect(container.textContent).toContain('Confluence')
    expect(container.textContent).toContain('Google Drive')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('enables in place and shows setup after the server confirms approval', async () => {
    await render()
    const row = document.querySelector('[aria-label="Allow Confluence in Sim Search"]')
    await click('Allow Confluence in Sim Search')
    expect(mocks.add).toHaveBeenCalledExactlyOnceWith(
      { organizationId: 'org-one', connectorType: 'confluence', approved: true },
      expect.any(Object)
    )
    expect(row).toHaveAttribute('aria-checked', 'false')
    mocks.overview.mockReturnValue({
      data: {
        providers: [
          ...providers,
          {
            connectorType: 'confluence',
            approved: true,
            sourceCount: 0,
            status: 'needs_setup',
            isSyncing: false,
          },
        ],
      },
      isPending: false,
    })
    await render()
    expect(document.querySelector('[aria-label="Allow Confluence in Sim Search"]')).toBe(row)
    expect(row).toHaveAttribute('aria-checked', 'true')
    expect(document.querySelector('a[aria-label="Set up Confluence"]')).not.toBeNull()
    expect(mocks.push).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('requires confirmation before disabling existing sources and lets the admin cancel', async () => {
    mocks.overview.mockReturnValue({
      data: { providers: [{ ...providers[1], approved: true }] },
      isPending: false,
    })
    await render()
    await click('Allow Google Drive in Sim Search')
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent(
      'Sources and connected accounts are preserved.'
    )
    expect(mocks.add).not.toHaveBeenCalled()
    await click('Cancel')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.add).not.toHaveBeenCalled()
    await click('Allow Google Drive in Sim Search')
    mocks.add.mockImplementation((_input, options) => options.onSuccess())
    await click('Deactivate')
    expect(mocks.add).toHaveBeenCalledExactlyOnceWith(
      { organizationId: 'org-one', connectorType: 'google_drive', approved: false },
      expect.any(Object)
    )
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('allows disabling an integration with no sources in place', async () => {
    await render()
    await click('Allow Gmail in Sim Search')
    expect(mocks.add).toHaveBeenCalledExactlyOnceWith(
      { organizationId: 'org-one', connectorType: 'gmail', approved: false },
      expect.any(Object)
    )
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps the confirmed state and reports failed approval changes', async () => {
    mocks.add.mockImplementation((_input, options) =>
      options.onError(new Error('Could not update integration'))
    )
    await render()
    await click('Allow Confluence in Sim Search')
    expect(toast.error).toHaveBeenCalledWith('Could not update integration')
    expect(document.querySelector('[aria-label="Allow Confluence in Sim Search"]')).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(document.querySelector('a[aria-label="Set up Confluence"]')).toBeNull()
  })

  it('keeps a failed deactivation in the confirmation dialog for retry', async () => {
    mocks.overview.mockReturnValue({
      data: { providers: [{ ...providers[1], approved: true }] },
      isPending: false,
    })
    await render()
    await click('Allow Google Drive in Sim Search')
    await click('Deactivate')
    mocks.mutationError = new Error('Could not deactivate integration')
    await render()
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent(
      'Could not deactivate integration'
    )
    expect(
      document.querySelector('[aria-label="Allow Google Drive in Sim Search"]')
    ).toHaveAttribute('aria-checked', 'true')
  })

  it('prevents duplicate changes while a mutation is pending', async () => {
    mocks.pending = true
    await render()
    await click('Allow Confluence in Sim Search')
    expect(mocks.add).not.toHaveBeenCalled()
    expect(document.querySelector('[aria-label="Allow Confluence in Sim Search"]')).toBeDisabled()
  })

  it('blocks unavailable setup while keeping existing sources manageable and deactivatable', async () => {
    mocks.availability.mockReturnValue({
      integrationAvailability: new Map(),
      oauthServiceAvailability: new Map(),
      isIntegrationAvailabilityReady: true,
    })
    mocks.overview.mockReturnValue({
      data: { providers: [{ ...providers[1], approved: true }] },
      isPending: false,
    })
    await render()
    expect(document.querySelector('[aria-label="Allow Confluence in Sim Search"]')).toBeDisabled()
    expect(
      document.querySelector('[aria-label="Allow Google Drive in Sim Search"]')
    ).not.toBeDisabled()
    expect(document.querySelector('a[aria-label="Manage Google Drive"]')).not.toBeNull()
    expect(container.textContent).toContain('Unavailable in this deployment')
    await click('Allow Confluence in Sim Search')
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('fails closed while availability loads and offers retry if it fails', async () => {
    mocks.availability.mockReturnValue({
      integrationAvailability: new Map(),
      oauthServiceAvailability: new Map(),
      isIntegrationAvailabilityReady: false,
      integrationAvailabilityError: new Error('Could not load connection availability'),
      refetchIntegrationAvailability: mocks.refetch,
    })
    await render()
    expect(document.querySelector('[aria-label="Allow Confluence in Sim Search"]')).toBeDisabled()
    await click('Try again')
    expect(mocks.refetch).toHaveBeenCalledOnce()
  })

  it('does not hide actionable sync failures behind a source count', async () => {
    mocks.overview.mockReturnValue({
      data: { providers: [{ ...providers[1], approved: true, status: 'needs_attention' }] },
      isPending: false,
    })
    await render()
    expect(container.textContent).toContain('Sync failed')
    expect(document.querySelector('a[aria-label="Manage Google Drive"]')).not.toBeNull()
  })

  it('does not turn a failed overview into unapproved switches', async () => {
    mocks.overview.mockReturnValue({
      error: new Error('Could not load sources'),
      isError: true,
      refetch: mocks.refetch,
    })
    await render()
    expect(document.querySelector('[role="switch"]')).toBeNull()
    await click('Try again')
    expect(mocks.refetch).toHaveBeenCalledOnce()
  })

  it('keeps loading distinct from unapproved integrations', async () => {
    mocks.overview.mockReturnValue({ isPending: true })
    await render()
    expect(container.textContent).toContain('Loading sources')
    expect(document.querySelector('[role="switch"]')).toBeNull()
  })

  it('does not expose admin controls or load admin data for members', async () => {
    mocks.admin = false
    await render()
    expect(mocks.overview).toHaveBeenLastCalledWith('org-one', { enabled: false })
    expect(container.textContent).toBe('')
  })

  it('filters the whole catalog without changing approvals', async () => {
    await render('?search=confluence')
    expect(container.textContent).toContain('Confluence')
    expect(container.textContent).not.toContain('Google Drive')
    expect(mocks.add).not.toHaveBeenCalled()
  })
})
