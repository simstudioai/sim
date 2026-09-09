/** @vitest-environment jsdom */
import { act } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/lib/api/client/errors'

const mocks = vi.hoisted(() => ({
  admin: true,
  personal: true,
  access: { admin: true, members: true },
  overview: vi.fn(),
  sources: vi.fn(),
  accounts: vi.fn(),
  people: vi.fn(),
  setup: vi.fn(),
  push: vi.fn(),
  updateUrl: vi.fn(),
  activate: vi.fn(),
  resetApproval: vi.fn(),
  approvalError: null as Error | null,
  availabilityError: null as Error | null,
  retryAvailability: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => '/o/org-one/settings/integrations/providers/google_drive',
}))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: () => ({
    organization: { id: 'org-one' },
    viewer: { isAdmin: mocks.admin },
    searchAccess: { memberScoped: true, sourceMirrored: true },
  }),
}))
vi.mock('@/lib/sim-search/connectors', () => ({
  canConnectPersonally: () => mocks.personal,
  getConnectorAccessAvailability: () => mocks.access,
}))
vi.mock('@/lib/oauth', () => ({
  getServiceConfigByServiceId: (providerId: string) => ({ providerId }),
  getServiceConfigByProviderId: (providerId: string) => ({ providerId }),
}))
vi.mock('@/lib/credential-groups/providers', () => ({
  findCredentialGroupProviderFromProviderId: (providerId: string) =>
    providerId.startsWith('google-') ? 'google' : providerId,
}))
vi.mock('@/connectors/registry', () => ({
  CONNECTOR_META_REGISTRY: {
    google_drive: { name: 'Google Drive', auth: { mode: 'oauth', provider: 'google-drive' } },
    gmail: { name: 'Gmail', auth: { mode: 'oauth', provider: 'google-email' } },
    slack: { name: 'Slack', auth: { mode: 'oauth', provider: 'slack' } },
    gitlab: { name: 'GitLab', auth: { mode: 'apiKey' } },
  },
}))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  useOrganizationSearchOverview: mocks.overview,
  useSearchSources: mocks.sources,
}))
vi.mock('@/hooks/queries/organization-accounts', () => ({
  useOrganizationAccounts: mocks.accounts,
}))
vi.mock('@/hooks/queries/search-integrations', () => ({
  useUpdateSearchIntegration: () => ({
    mutate: mocks.activate,
    reset: mocks.resetApproval,
    error: mocks.approvalError,
    isPending: false,
  }),
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({
    integrationAvailability: new Map(),
    oauthServiceAvailability: new Map(),
    isIntegrationAvailabilityReady: !mocks.availabilityError,
    integrationAvailabilityError: mocks.availabilityError,
    refetchIntegrationAvailability: mocks.retryAvailability,
  }),
}))
vi.mock('@/ee/credential-groups/components/organization-account-people', () => ({
  OrganizationAccountPeople: (props: unknown) => {
    mocks.people(props)
    return <p>Provider account connections</p>
  },
}))
vi.mock('@/app/workspace/[workspaceId]/search/components/search-source-setup', () => ({
  SearchSourceSetup: (props: unknown) => {
    mocks.setup(props)
    return null
  },
}))
vi.mock('@/app/o/[organizationId]/settings/components/integrations/slack-account-setup', () => ({
  OrganizationSlackAccountSetup: () => null,
}))

import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { OrganizationProviderDetail } from '@/app/o/[organizationId]/settings/integrations/providers/[connectorType]/provider-detail'

const provider = { connectorType: 'google_drive', approved: true, status: 'active' }
const source = {
  connectorId: 'source-one',
  connectorType: 'google_drive',
  sourceDescription: 'Engineering handbook',
  enabled: true,
  hasSyncError: false,
  isSyncing: false,
  lastSyncAt: '2026-09-08T12:00:00.000Z',
  connectionRequired: true,
  viewerMembership: 'needs_reauth',
  viewerDocumentCount: 0,
}
const credentialGroup = {
  id: 'accounts-one',
  options: [{ id: 'google-option', provider: 'google', status: 'active' }],
}

describe('organization provider management', () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.admin = true
    mocks.personal = true
    mocks.access = { admin: true, members: true }
    mocks.approvalError = null
    mocks.availabilityError = null
    mocks.overview.mockReturnValue({ data: { providers: [provider] }, isPending: false })
    mocks.sources.mockReturnValue({
      data: [source],
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      error: null,
      fetchNextPage: vi.fn(),
    })
    mocks.accounts.mockReturnValue({ data: { credentialGroup }, isPending: false })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })
  async function render(connectorType = 'google_drive', searchParams = '') {
    await act(async () =>
      root.render(
        <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={mocks.updateUrl}>
          <SettingsHeaderProvider>
            <SettingsHeaderShell>
              <OrganizationProviderDetail connectorType={connectorType} />
            </SettingsHeaderShell>
          </SettingsHeaderProvider>
        </NuqsTestingAdapter>
      )
    )
  }
  async function click(label: string) {
    const button = Array.from(document.querySelectorAll('button')).find(
      (item) => item.textContent?.trim() === label
    )
    expect(button, `Missing ${label}`).toBeTruthy()
    await act(async () => button!.click())
  }

  it('uses named source links even when the admin has not reconnected their own account', async () => {
    await render()
    expect(mocks.sources).toHaveBeenCalledWith(
      { kind: 'organization', organizationId: 'org-one' },
      { connectorType: 'google_drive', search: '', enabled: true }
    )
    expect(container.querySelector('a[aria-label="Open Engineering handbook"]')).toHaveAttribute(
      'href',
      '/o/org-one/settings/integrations/sources/source-one'
    )
    expect(container.textContent).not.toContain('Connect account')
    expect(container.textContent).not.toContain('Reconnect')
    expect(container.textContent).not.toContain('0 searchable documents')
  })

  it('loads sources for a nonpersonal provider even when an accounts view URL is supplied', async () => {
    mocks.personal = false
    mocks.overview.mockReturnValue({
      data: { providers: [{ ...provider, connectorType: 'gitlab' }] },
    })
    await render('gitlab', '?view=accounts')
    expect(mocks.sources).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ connectorType: 'gitlab', enabled: true })
    )
    expect(mocks.accounts).toHaveBeenCalledWith(undefined)
    expect(mocks.people).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Engineering handbook')
  })

  it('does not claim a provider is empty before paginated source discovery finishes', async () => {
    const fetchNextPage = vi.fn()
    mocks.sources.mockReturnValue({ data: [], isPending: false, hasNextPage: true, fetchNextPage })
    await render()
    expect(container.textContent).not.toContain('No sources yet')
    await click('Load more')
    expect(fetchNextPage).toHaveBeenCalledOnce()
  })

  it('keeps source links visible and retries a failed next page', async () => {
    const fetchNextPage = vi.fn()
    mocks.sources.mockReturnValue({
      data: [source],
      isError: true,
      isFetchNextPageError: true,
      error: new Error('More sources unavailable'),
      hasNextPage: true,
      fetchNextPage,
    })
    await render()
    expect(container.textContent).toContain('Engineering handbook')
    expect(container.textContent).toContain('More sources unavailable')
    await click('Try again')
    expect(fetchNextPage).toHaveBeenCalledOnce()
  })

  it.each(['', '?view=accounts'])(
    'renders overview loading without presenting missing configuration at %s',
    async (params) => {
      mocks.overview.mockReturnValue({ isPending: true })
      await render('google_drive', params)
      expect(container.textContent).toContain('Loading integration')
      expect(container.textContent).not.toContain('Activate this integration')
      expect(mocks.people).not.toHaveBeenCalled()
      expect(
        container.querySelector(
          `input[placeholder="${params ? 'Search people...' : 'Search sources...'}"]`
        )
      ).toBeEnabled()
    }
  )

  it('hides cached account content and retries when overview access is revoked', async () => {
    const refetch = vi.fn()
    mocks.overview.mockReturnValue({
      data: { providers: [provider] },
      isError: true,
      error: new ApiClientError({ status: 403, message: 'Access denied', body: null }),
      refetch,
    })
    await render('google_drive', '?view=accounts&credential-group-people=alex')
    expect(container.textContent).toContain('Access denied')
    expect(mocks.people).not.toHaveBeenCalled()
    expect(container.querySelector('input[placeholder="Search people..."]')).toHaveValue('alex')
    expect(container.querySelector('input[placeholder="Search people..."]')).toBeEnabled()
    await click('Try again')
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('offers activation from the accounts tab when an existing provider is deactivated', async () => {
    mocks.overview.mockReturnValue({ data: { providers: [{ ...provider, approved: false }] } })
    await render('google_drive', '?view=accounts&credential-group-people=alex')
    expect(mocks.people).not.toHaveBeenCalled()
    expect(container.querySelector('input[placeholder="Search people..."]')).toHaveValue('alex')
    expect(container.querySelector('input[placeholder="Search people..."]')).toBeEnabled()
    await click('Activate')
    expect(mocks.activate).toHaveBeenCalledWith({
      organizationId: 'org-one',
      connectorType: 'google_drive',
      approved: true,
    })
  })

  it('shows activation failures on Accounts and keeps activation available for retry', async () => {
    mocks.overview.mockReturnValue({ data: { providers: [{ ...provider, approved: false }] } })
    mocks.approvalError = new Error('Activation could not be saved')
    await render('google_drive', '?view=accounts')
    expect(container.textContent).toContain('Activation could not be saved')
    expect(mocks.people).not.toHaveBeenCalled()
    await click('Activate')
    expect(mocks.activate).toHaveBeenCalledWith({
      organizationId: 'org-one',
      connectorType: 'google_drive',
      approved: true,
    })
  })

  it.each([
    ['loading', 'Loading accounts…'],
    ['error', 'Accounts unavailable'],
    ['missing group', 'Add a source to set up account connections.'],
    ['missing provider option', 'Add a source to set up account connections.'],
  ])('preserves Accounts search while %s', async (state, message) => {
    const refetch = vi.fn()
    mocks.accounts.mockReturnValue(
      state === 'loading'
        ? { isPending: true }
        : state === 'error'
          ? { isError: true, error: new Error(message), refetch }
          : {
              data: {
                credentialGroup:
                  state === 'missing group' ? null : { ...credentialGroup, options: [] },
              },
              isPending: false,
            }
    )
    await render('google_drive', '?view=accounts&credential-group-people=alex&search=handbook')

    expect(container.textContent).toContain(message)
    expect(container.querySelector('input[placeholder="Search people..."]')).toHaveValue('alex')
    expect(container.querySelector('input[placeholder="Search people..."]')).toBeEnabled()
    expect(container.querySelector('input[placeholder="Search sources..."]')).toBeNull()
    expect(mocks.people).not.toHaveBeenCalled()
    if (state === 'error') {
      await click('Try again')
      expect(refetch).toHaveBeenCalledOnce()
    }

    const sourcesTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    ).find((item) => item.textContent === 'Sources')
    expect(sourcesTab).toBeDefined()
    await act(async () => sourcesTab!.click())
    expect(container.querySelector('input[placeholder="Search sources..."]')).toHaveValue(
      'handbook'
    )
    await click('Accounts')
    expect(container.querySelector('input[placeholder="Search people..."]')).toHaveValue('alex')
  })

  it('preserves source navigation and retries connection availability failures', async () => {
    mocks.availabilityError = new Error('Connection availability could not be loaded')
    await render()
    expect(container.textContent).toContain('Connection availability could not be loaded')
    expect(container.querySelector('a[aria-label="Open Engineering handbook"]')).toHaveAttribute(
      'href',
      '/o/org-one/settings/integrations/sources/source-one'
    )
    await click('Try again')
    expect(mocks.retryAvailability).toHaveBeenCalledOnce()
    await click('Deactivate')
    expect(document.body.textContent).toContain('Deactivate Google Drive?')
    expect(mocks.activate).not.toHaveBeenCalled()
  })

  it('explains and retries Slack account lookup failures without hiding its sources', async () => {
    const refetch = vi.fn()
    mocks.access = { admin: false, members: true }
    mocks.overview.mockReturnValue({
      data: { providers: [{ ...provider, connectorType: 'slack' }] },
    })
    mocks.accounts.mockReturnValue({
      isError: true,
      error: new Error('Slack accounts could not be loaded'),
      refetch,
    })
    await render('slack')
    expect(container.textContent).toContain('Slack accounts could not be loaded')
    expect(container.textContent).toContain('Engineering handbook')
    const setupButton = Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent?.trim() === 'Set up Slack app'
    )
    expect(setupButton).toBeDisabled()
    await click('Try again')
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('scopes account management and connection requests to the current provider option', async () => {
    await render('google_drive', '?view=accounts')
    expect(mocks.sources).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ enabled: false })
    )
    expect(mocks.people).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-one',
        searchConnection: { optionId: 'google-option', providerName: 'Google Drive' },
      })
    )
  })

  it.each([
    { type: 'google_drive', access: { admin: true, members: true }, memberParam: false },
    { type: 'gmail', access: { admin: false, members: true }, memberParam: true },
  ])(
    'opens $type setup with its supported connection mode',
    async ({ type, access, memberParam }) => {
      mocks.access = access
      mocks.overview.mockReturnValue({
        data: { providers: [{ ...provider, connectorType: type }] },
      })
      await render(type)
      await click('Add source')
      const query = new URLSearchParams(mocks.updateUrl.mock.calls.at(-1)![0].queryString)
      expect(query.get('addConnector')).toBe(type)
      expect(query.get('source-access')).toBe(memberParam ? 'members' : null)
    }
  )

  it('opens Slack app setup before adding a source when its bot is missing', async () => {
    mocks.access = { admin: false, members: true }
    mocks.overview.mockReturnValue({
      data: { providers: [{ ...provider, connectorType: 'slack' }] },
    })
    mocks.accounts.mockReturnValue({ data: { credentialGroup: null }, isPending: false })
    await render('slack')
    await click('Set up Slack app')
    const query = new URLSearchParams(mocks.updateUrl.mock.calls.at(-1)![0].queryString)
    expect(query.get('connectedAccounts')).toBe('slack')
    expect(query.has('addConnector')).toBe(false)
  })

  it.each([
    { name: 'missing bot', slackBotCredentialId: undefined, configurationStatus: 'ready' },
    {
      name: 'outdated app',
      slackBotCredentialId: 'slack-bot',
      configurationStatus: 'needs_update',
    },
  ])('offers Slack Accounts recovery for an active option with $name', async (option) => {
    mocks.access = { admin: false, members: true }
    mocks.overview.mockReturnValue({
      data: { providers: [{ ...provider, connectorType: 'slack' }] },
    })
    mocks.accounts.mockReturnValue({
      data: {
        credentialGroup: {
          ...credentialGroup,
          options: [
            {
              id: 'slack-option',
              provider: 'slack',
              status: 'active',
              slackBotCredentialId: option.slackBotCredentialId,
              configurationStatus: option.configurationStatus,
            },
          ],
        },
      },
      isPending: false,
    })
    await render('slack', '?view=accounts&credential-group-people=alex')

    expect(mocks.people).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Set up the Slack app to connect accounts.')
    expect(container.querySelector('input[placeholder="Search people..."]')).toHaveValue('alex')
    await click('Set up Slack app')
    const query = new URLSearchParams(mocks.updateUrl.mock.calls.at(-1)![0].queryString)
    expect(query.get('connectedAccounts')).toBe('slack')
    expect(query.get('view')).toBe('accounts')
    expect(query.get('credential-group-people')).toBe('alex')
    expect(query.has('addConnector')).toBe(false)
  })

  it('opens focused account management after the Slack app is ready', async () => {
    mocks.access = { admin: false, members: true }
    mocks.overview.mockReturnValue({
      data: { providers: [{ ...provider, connectorType: 'slack' }] },
    })
    mocks.accounts.mockReturnValue({
      data: {
        credentialGroup: {
          ...credentialGroup,
          options: [
            {
              id: 'slack-option',
              provider: 'slack',
              status: 'active',
              slackBotCredentialId: 'slack-bot',
              configurationStatus: 'ready',
            },
          ],
        },
      },
      isPending: false,
    })
    await render('slack', '?view=accounts')

    expect(mocks.people).toHaveBeenCalledWith(
      expect.objectContaining({
        searchConnection: { optionId: 'slack-option', providerName: 'Slack' },
      })
    )
    expect(container.textContent).not.toContain('Set up the Slack app to connect accounts.')
  })

  it('does not load admin queries or render setup controls for nonadmins', async () => {
    mocks.admin = false
    await render()
    expect(mocks.overview).toHaveBeenCalledWith('org-one', { enabled: false })
    expect(mocks.sources).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ enabled: false })
    )
    expect(mocks.accounts).toHaveBeenCalledWith(undefined)
    expect(mocks.setup).not.toHaveBeenCalled()
    expect(mocks.people).not.toHaveBeenCalled()
  })
})
