/** @vitest-environment jsdom */
import { act } from 'react'
import { toast } from '@sim/emcn'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrganizationSearchProviderSummary } from '@/lib/api/contracts/knowledge/connectors'

const mocks = vi.hoisted(() => ({
  admin: true,
  memberAccess: true,
  mirroredAccess: true,
  updateUrl: vi.fn(),
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
    searchAccess: { memberScoped: mocks.memberAccess, sourceMirrored: mocks.mirroredAccess },
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
  mocks.memberAccess = true
  mocks.mirroredAccess = true
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
      ['jira', true],
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
      <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={mocks.updateUrl}>
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

async function expectSetup(type: string | null, access: string | null = null) {
  await act(async () => {
    await vi.waitFor(() => {
      const params = mocks.updateUrl.mock.calls.at(-1)?.[0].searchParams
      expect(params).toBeDefined()
      expect(params.get('addConnector')).toBe(type)
      expect(params.get('source-access')).toBe(access)
    })
  })
}

async function fillPicker(value: string) {
  const input = document.querySelector<HTMLInputElement>('[aria-label="Find a source"]')
  expect(input).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('organization integration management entry', () => {
  it('uses navigable settings rows for added sources without switches or setup buttons', async () => {
    await render()
    expect(container.textContent).toContain('Waiting for connections')
    expect(container.textContent).toContain('Deactivated · 2 connections')
    expect(container.querySelector('a[aria-label="Manage Gmail"]')).toHaveAttribute(
      'href',
      '/o/org-one/settings/integrations/providers/gmail'
    )
    expect(container.querySelector('a[aria-label="Manage Google Drive"]')).not.toBeNull()
    expect(container.textContent).not.toContain('Confluence')
    expect(container.querySelector('[role="switch"]')).toBeNull()
    expect(container.querySelector('a[aria-label="Set up Gmail"]')).toBeNull()
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('keeps approved sources with unfinished setup visible', async () => {
    mocks.overview.mockReturnValue({
      data: {
        providers: [
          {
            ...providers[0],
            connectorType: 'confluence',
            status: 'needs_setup',
          },
        ],
      },
      isPending: false,
    })
    await render()
    expect(container.textContent).toContain('Setup required')
    expect(container.querySelector('a[aria-label="Manage Confluence"]')).not.toBeNull()
  })

  it('opens the catalog from the header without changing any approvals', async () => {
    mocks.overview.mockReturnValue({ data: { providers: [] }, isPending: false })
    await render()
    expect(container.textContent).toContain('No sources yet. Add a source to get started.')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await click('Add source')
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Confluence')
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Jira')
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Connect a service account')
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Connect member accounts')
    expect(mocks.add).not.toHaveBeenCalled()
    await click('Cancel')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await expectSetup(null)
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('approves a new source before opening its central configuration form', async () => {
    await render('?addConnector=')
    await click('Set up Confluence')
    expect(mocks.add).toHaveBeenCalledExactlyOnceWith(
      { organizationId: 'org-one', connectorType: 'confluence', approved: true },
      expect.any(Object)
    )
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => mocks.add.mock.calls[0][1].onSuccess())
    await expectSetup('confluence')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('opens an approved source directly without a duplicate approval', async () => {
    await render('?addConnector=&search=retained')
    await click('Set up Gmail')
    await expectSetup('gmail')
    expect(mocks.updateUrl.mock.calls.at(-1)?.[0].searchParams.get('search')).toBe('retained')
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it.each(['jira', 'confluence'])(
    'uses member setup for %s when central indexing is unavailable',
    async (type) => {
      mocks.mirroredAccess = false
      mocks.add.mockImplementation((_input, options) => options.onSuccess())
      await render('?addConnector=')
      await click(`Set up ${type === 'jira' ? 'Jira' : 'Confluence'}`)
      await expectSetup(type, 'members')
    }
  )

  it('routes Slack into the existing member setup with its custom-app step', async () => {
    mocks.availability.mockReturnValue({
      integrationAvailability: new Map([['slack_v2', { state: 'limited' }]]),
      oauthServiceAvailability: new Map(),
      isIntegrationAvailabilityReady: true,
    })
    mocks.add.mockImplementation((_input, options) => options.onSuccess())
    await render('?addConnector=')
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Set up your Slack app')
    await click('Set up Slack')
    await expectSetup('slack', 'members')
  })

  it('reactivates a retained source before opening another configuration', async () => {
    mocks.add.mockImplementation((_input, options) => options.onSuccess())
    await render('?addConnector=')
    await click('Set up Google Drive')
    await expectSetup('google_drive')
    expect(mocks.add).toHaveBeenCalledWith(
      { organizationId: 'org-one', connectorType: 'google_drive', approved: true },
      expect.any(Object)
    )
  })

  it('keeps the picker open and toasts a failed approval for retry', async () => {
    mocks.add.mockImplementation((_input, options) =>
      options.onError(new Error('Could not add source'))
    )
    await render('?addConnector=')
    await click('Set up Confluence')
    expect(toast.error).toHaveBeenCalledWith('Could not add source')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(mocks.updateUrl).not.toHaveBeenCalled()
  })

  it('prevents another selection or dismissal while approval is pending', async () => {
    mocks.pending = true
    await render('?addConnector=')
    expect(document.querySelector('button[aria-label="Set up Confluence"]')).toBeNull()
    expect(document.querySelector('[aria-label="Find a source"]')).toBeDisabled()
    await click('Cancel')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.updateUrl).not.toHaveBeenCalled()
  })

  it('explains unavailable providers in the picker without allowing setup', async () => {
    mocks.availability.mockReturnValue({
      integrationAvailability: new Map(),
      oauthServiceAvailability: new Map(),
      isIntegrationAvailabilityReady: true,
    })
    await render('?addConnector=')
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent(
      'Unavailable in this deployment'
    )
    expect(document.querySelector('button[aria-label="Set up Confluence"]')).toBeNull()
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('keeps existing unavailable sources manageable', async () => {
    mocks.availability.mockReturnValue({
      integrationAvailability: new Map(),
      oauthServiceAvailability: new Map(),
      isIntegrationAvailabilityReady: true,
    })
    await render()
    expect(container.querySelector('a[aria-label="Manage Gmail"]')).not.toBeNull()
    expect(container.querySelector('a[aria-label="Manage Google Drive"]')).not.toBeNull()
  })

  it('filters the picker independently from the main source list and resets when reopened', async () => {
    await render('?search=gmail')
    await click('Add source')
    await fillPicker('confluence')
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).toHaveTextContent('Confluence')
    expect(dialog).not.toHaveTextContent('Google Drive')
    expect(container.querySelector('a[aria-label="Manage Gmail"]')).not.toBeNull()
    await fillPicker('no-such-source')
    expect(dialog).toHaveTextContent('No matching sources')
    await click('Cancel')
    await click('Add source')
    expect(document.querySelector('[aria-label="Find a source"]')).toHaveValue('')
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Google Drive')
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('keeps source health visible alongside the configuration count', async () => {
    mocks.overview.mockReturnValue({
      data: {
        providers: [
          {
            ...providers[1],
            approved: true,
            status: 'needs_attention',
            issue: 'sync_failed',
          },
        ],
      },
      isPending: false,
    })
    await render()
    expect(container.textContent).toContain('Sync failed · 2 connections')
  })

  it('fails closed and offers retry when availability fails inside the picker', async () => {
    mocks.availability.mockReturnValue({
      integrationAvailability: new Map(),
      oauthServiceAvailability: new Map(),
      isIntegrationAvailabilityReady: true,
      integrationAvailabilityError: new Error('Could not load connection availability'),
      refetchIntegrationAvailability: mocks.refetch,
    })
    await render('?addConnector=')
    expect(document.querySelector('[role="dialog"]')).toHaveTextContent(
      'Could not load connection availability'
    )
    expect(document.querySelector('button[aria-label="Set up Confluence"]')).toBeNull()
    await click('Try again')
    expect(mocks.refetch).toHaveBeenCalledOnce()
  })

  it('does not turn a failed overview into an empty source list', async () => {
    mocks.overview.mockReturnValue({
      error: new Error('Could not load sources'),
      isError: true,
      refetch: mocks.refetch,
    })
    await render()
    expect(container.textContent).not.toContain('No sources yet')
    expect(
      Array.from(container.querySelectorAll('button')).find(
        (node) => node.textContent === 'Add source'
      )
    ).toBeDisabled()
    await click('Try again')
    expect(mocks.refetch).toHaveBeenCalledOnce()
  })

  it('keeps loading distinct from a new organization', async () => {
    mocks.overview.mockReturnValue({ isPending: true })
    await render()
    expect(container.textContent).toContain('Loading sources')
    expect(container.textContent).not.toContain('No sources yet')
    expect(
      Array.from(container.querySelectorAll('button')).find(
        (node) => node.textContent === 'Add source'
      )
    ).toBeDisabled()
  })

  it('does not expose admin controls or load admin data for members', async () => {
    mocks.admin = false
    await render('?addConnector=')
    expect(mocks.overview).toHaveBeenLastCalledWith('org-one', { enabled: false })
    expect(container.textContent).toBe('')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('does not expose setup when Search is disabled', async () => {
    mocks.memberAccess = false
    mocks.mirroredAccess = false
    await render('?addConnector=')
    expect(container.textContent).toContain('Search sources are not enabled')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('filters added sources without changing approvals', async () => {
    await render('?search=gmail')
    expect(container.textContent).toContain('Gmail')
    expect(container.textContent).not.toContain('Google Drive')
    expect(mocks.add).not.toHaveBeenCalled()
  })
})
