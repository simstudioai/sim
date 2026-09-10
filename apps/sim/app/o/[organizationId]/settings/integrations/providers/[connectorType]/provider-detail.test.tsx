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
  removeAccounts: vi.fn(),
  accountRemovalError: null as Error | null,
  accountRemovalPending: false,
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
  canConnectWithDefaults: (meta: { name: string }) =>
    ['Gmail', 'Google Calendar', 'Google Drive'].includes(meta.name),
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
    google_drive: {
      name: 'Google Drive',
      auth: { mode: 'oauth', provider: 'google-drive', adminCredentialType: 'service_account' },
    },
    gmail: {
      name: 'Gmail',
      auth: { mode: 'oauth', provider: 'google-email', adminCredentialType: 'service_account' },
    },
    google_calendar: {
      name: 'Google Calendar',
      auth: { mode: 'oauth', provider: 'google-calendar', adminCredentialType: 'service_account' },
    },
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
  useUpdateOrganizationAccounts: () => ({
    mutate: mocks.removeAccounts,
    error: mocks.accountRemovalError,
    isPending: mocks.accountRemovalPending,
  }),
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
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'

const provider = {
  connectorType: 'google_drive',
  approved: true,
  status: 'active',
  sourceCount: 0,
}
const source = {
  connectorId: 'source-one',
  connectorType: 'google_drive',
  sourceDescription: 'Engineering handbook',
  accessMode: 'admin',
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
    mocks.accountRemovalError = null
    mocks.accountRemovalPending = false
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

  function withSlackAccounts(approved = true, status = 'active') {
    mocks.overview.mockReturnValue({
      data: { providers: [{ ...provider, connectorType: 'slack', approved }] },
    })
    mocks.accounts.mockReturnValue({
      data: {
        credentialGroup: {
          ...credentialGroup,
          options: [
            { ...credentialGroup.options[0], label: 'Google', required: true },
            {
              id: 'slack-option',
              provider: 'slack',
              label: 'Slack',
              required: false,
              status,
              configurationStatus: 'ready',
            },
          ],
        },
      },
    })
  }

  it.each(['gmail', 'google_calendar', 'google_drive'])(
    'offers configuration setup directly for %s without an Accounts or Advanced tab',
    async (connectorType) => {
      mocks.overview.mockReturnValue({
        data: { providers: [{ ...provider, connectorType, status: 'waiting_for_connections' }] },
      })
      mocks.sources.mockReturnValue({ data: [], isPending: false })
      await render(connectorType)
      expect(container.textContent).toContain('Waiting for connections')
      expect(container.textContent).toContain(
        `No ${CONNECTOR_META_REGISTRY[connectorType]?.name} connections yet.`
      )
      expect(container.querySelector('[role="radio"]')).toBeNull()
      await click('Connect service account')
      await vi.waitFor(() => {
        expect(mocks.updateUrl.mock.calls.at(-1)?.[0].searchParams.get('addConnector')).toBe(
          connectorType
        )
      })
    }
  )

  it.each(['gmail', 'google_calendar', 'google_drive'])(
    'does not ask for personal connections when %s already has a central source',
    async (connectorType) => {
      mocks.overview.mockReturnValue({
        data: {
          providers: [{ ...provider, connectorType, sourceCount: 1 }],
        },
      })
      mocks.accounts.mockReturnValue({ data: { credentialGroup: null }, isPending: false })
      mocks.access = { admin: true, members: true }
      await render(connectorType)

      expect(container.textContent).toContain('Engineering handbook')
      expect(container.textContent).not.toContain('No connected member accounts.')
      expect(container.textContent).not.toContain(
        'Members connect their accounts from Integrations.'
      )
      await click('Connect service account')
      await vi.waitFor(() => {
        const params = mocks.updateUrl.mock.calls.at(-1)![0].searchParams
        expect(params.get('addConnector')).toBe(connectorType)
        expect(params.get('source-access')).toBeNull()
      })
    }
  )

  describe.each(['gmail', 'google_calendar', 'google_drive'])(
    '%s default management view',
    (connectorType) => {
      function withSources(accessModes: string[]) {
        mocks.overview.mockReturnValue({
          data: { providers: [{ ...provider, connectorType, sourceCount: accessModes.length }] },
          isPending: false,
        })
        mocks.sources.mockReturnValue({
          data: accessModes.map((accessMode, index) => ({
            ...source,
            connectorType,
            accessMode,
            connectorId: `source-${index}`,
          })),
          isPending: false,
        })
      }

      it.each([
        { name: 'member-only', modes: ['members'] },
        { name: 'central-only', modes: ['admin'] },
        { name: 'mixed', modes: ['admin', 'members'] },
        { name: 'not configured', modes: [] },
      ])('opens configurations for the $name setup', async ({ modes }) => {
        withSources(modes)
        await render(connectorType)
        expect(container.querySelector('[role="radio"]')).toBeNull()
        expect(mocks.sources).toHaveBeenLastCalledWith(
          expect.any(Object),
          expect.objectContaining({ enabled: true })
        )
        expect(mocks.accounts).toHaveBeenLastCalledWith(undefined)
        expect(container.textContent).toContain('Connect service account')
        if (modes.length === 0)
          expect(container.textContent).toContain(
            `No ${CONNECTOR_META_REGISTRY[connectorType]?.name} connections yet.`
          )
      })

      it('loads the configuration list in parallel with its overview and retains the default', async () => {
        mocks.overview.mockReturnValue({ isPending: true })
        await render(connectorType)
        expect(container.textContent).toContain('Loading integration…')
        expect(container.textContent).not.toContain('No connected member accounts.')
        expect(mocks.accounts).toHaveBeenLastCalledWith(undefined)
        expect(mocks.sources).toHaveBeenLastCalledWith(
          expect.any(Object),
          expect.objectContaining({ enabled: true })
        )
        withSources(['members'])
        await render(connectorType)
        expect(container.querySelector('[role="radio"]')).toBeNull()
        expect(container.textContent).toContain('Engineering handbook')
        expect(mocks.sources).toHaveBeenLastCalledWith(
          expect.any(Object),
          expect.objectContaining({ enabled: true })
        )
        expect(mocks.accounts).toHaveBeenLastCalledWith(undefined)
      })
    }
  )

  it.each(['active', 'disabled'])(
    'removes only Slack account setup after confirmation, including a %s option',
    async (status) => {
      withSlackAccounts(true, status)
      await render('slack')
      const headerRemove = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Remove app setup'
      )
      const deactivate = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Deactivate'
      )
      expect(headerRemove?.className).toBe(deactivate?.className)
      expect(headerRemove?.querySelector('[class*="text-error"]')).toBeNull()
      await click('Remove app setup')
      expect(mocks.removeAccounts).not.toHaveBeenCalled()
      expect(document.querySelector('[role="dialog"]')).toHaveTextContent('saved app configuration')
      await click('Remove')
      expect(mocks.removeAccounts).toHaveBeenCalledExactlyOnceWith(
        {
          organizationId: 'org-one',
          groupId: 'accounts-one',
          update: {
            options: [{ id: 'google-option', provider: 'google', label: 'Google', required: true }],
          },
        },
        { onSuccess: expect.any(Function) }
      )
      await act(async () => mocks.removeAccounts.mock.calls[0][1].onSuccess())
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    }
  )

  it('offers removal when Slack is deactivated and allows cancelling without a mutation', async () => {
    withSlackAccounts(false)
    await render('slack')
    await click('Remove app setup')
    await click('Cancel')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.removeAccounts).not.toHaveBeenCalled()
  })

  it('keeps connector-dependency errors visible in the removal dialog', async () => {
    withSlackAccounts()
    mocks.accountRemovalError = new Error('Remove the source using these accounts first.')
    await render('slack')
    await click('Remove app setup')
    await click('Remove')
    expect(document.querySelector('[role="dialog"] [role="alert"]')).toHaveTextContent(
      'Remove the source using these accounts first.'
    )
  })

  it('keeps Slack cleanup available even when personal source creation is unavailable', async () => {
    withSlackAccounts()
    mocks.personal = false
    await render('slack')
    expect(mocks.accounts).toHaveBeenCalledWith('org-one')
    await click('Remove app setup')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('uses named source links even when the admin has not reconnected their own account', async () => {
    await render('google_drive', '?view=sources')
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
    await render('google_drive', '?view=sources')
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
    await render('google_drive', '?view=sources')
    expect(container.textContent).toContain('Engineering handbook')
    expect(container.textContent).toContain('More sources unavailable')
    await click('Try again')
    expect(fetchNextPage).toHaveBeenCalledOnce()
  })

  it.each(['', '?view=accounts', '?view=sources'])(
    'renders overview loading without presenting missing configuration at %s',
    async (params) => {
      mocks.overview.mockReturnValue({ isPending: true })
      await render('google_drive', params)
      expect(container.textContent).toContain('Loading integration')
      expect(container.textContent).not.toContain('Activate this integration')
      expect(mocks.people).not.toHaveBeenCalled()
      expect(
        container.querySelector('input[placeholder="Search Google Drive connections..."]')
      ).toBeEnabled()
    }
  )

  it('hides cached source content and retries when overview access is revoked', async () => {
    const refetch = vi.fn()
    mocks.overview.mockReturnValue({
      data: { providers: [provider] },
      isError: true,
      error: new ApiClientError({ status: 403, message: 'Access denied', body: null }),
      refetch,
    })
    await render('google_drive', '?search=alex')
    expect(container.textContent).toContain('Access denied')
    expect(mocks.people).not.toHaveBeenCalled()
    expect(
      container.querySelector('input[placeholder="Search Google Drive connections..."]')
    ).toHaveValue('alex')
    expect(
      container.querySelector('input[placeholder="Search Google Drive connections..."]')
    ).toBeEnabled()
    await click('Try again')
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('offers activation when an existing provider is deactivated', async () => {
    mocks.overview.mockReturnValue({ data: { providers: [{ ...provider, approved: false }] } })
    await render('google_drive', '?search=alex')
    expect(mocks.people).not.toHaveBeenCalled()
    expect(
      container.querySelector('input[placeholder="Search Google Drive connections..."]')
    ).toHaveValue('alex')
    expect(
      container.querySelector('input[placeholder="Search Google Drive connections..."]')
    ).toBeEnabled()
    await click('Activate')
    expect(mocks.activate).toHaveBeenCalledWith({
      organizationId: 'org-one',
      connectorType: 'google_drive',
      approved: true,
    })
  })

  it('shows activation failures and keeps activation available for retry', async () => {
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

  it('preserves source navigation and retries connection availability failures', async () => {
    mocks.availabilityError = new Error('Connection availability could not be loaded')
    await render('google_drive', '?view=sources')
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

  it('explains unavailable integrations instead of showing an empty setup dead end', async () => {
    mocks.access = { admin: false, members: false }
    mocks.overview.mockReturnValue({
      data: { providers: [{ ...provider, connectorType: 'gitlab' }] },
    })
    mocks.sources.mockReturnValue({ data: [], isPending: false })
    await render('gitlab')
    expect(container.textContent).toContain('Unavailable in this deployment')
    expect(container.textContent).toContain('GitLab must be configured for this deployment')
    expect(container.textContent).not.toContain('No GitLab projects added')
    expect(container.textContent).not.toContain('Add project')
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
      await click(memberParam ? 'Set up member accounts' : 'Connect service account')
      await vi.waitFor(() => {
        expect(mocks.updateUrl).toHaveBeenCalled()
        const query = new URLSearchParams(mocks.updateUrl.mock.calls.at(-1)![0].queryString)
        expect(query.get('addConnector')).toBe(type)
        expect(query.get('source-access')).toBe(memberParam ? 'members' : null)
      })
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
    await vi.waitFor(() => {
      expect(mocks.updateUrl).toHaveBeenCalled()
      const query = new URLSearchParams(mocks.updateUrl.mock.calls.at(-1)![0].queryString)
      expect(query.get('connectedAccounts')).toBe('slack')
      expect(query.has('addConnector')).toBe(false)
    })
  })

  it.each([
    {
      name: 'missing configuration',
      slackBotCredentialId: undefined,
      configurationStatus: 'not_configured',
    },
    {
      name: 'outdated app',
      slackBotCredentialId: 'slack-bot',
      configurationStatus: 'needs_update',
    },
  ])('offers Slack app recovery for an active option with $name', async (option) => {
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
    await render('slack')

    expect(mocks.people).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Set up Slack app')
    await click('Set up Slack app')
    await act(async () => {
      await vi.waitFor(() => expect(mocks.updateUrl).toHaveBeenCalled())
    })
    const query = new URLSearchParams(mocks.updateUrl.mock.calls.at(-1)![0].queryString)
    expect(query.get('connectedAccounts')).toBe('slack')
    expect(query.has('addConnector')).toBe(false)
  })

  it.each([undefined, 'slack-bot'])(
    'allows source setup with verified Slack configuration and bot credential %s',
    async (slackBotCredentialId) => {
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
                slackBotCredentialId,
                configurationStatus: 'ready',
              },
            ],
          },
        },
        isPending: false,
      })
      await render('slack', '?view=accounts')

      expect(container.textContent).toContain('Add channels or DMs')
      expect(mocks.people).not.toHaveBeenCalled()
      expect(container.textContent).not.toContain('Set up the Slack app to connect accounts.')
    }
  )

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
