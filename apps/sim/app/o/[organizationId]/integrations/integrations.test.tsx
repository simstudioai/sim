/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { toast } from '@sim/emcn'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchSourceSummary } from '@/lib/api/contracts/knowledge/connectors'
import type { SearchConnector } from '@/lib/sim-search/connectors'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  sources: vi.fn(),
  overview: vi.fn(),
  integrations: vi.fn(),
  slackInventory: vi.fn(),
  filters: vi.fn(),
  connect: vi.fn(),
  connectSearchSource: vi.fn(),
  availability: vi.fn(),
  refetch: vi.fn(),
  nextPage: vi.fn(),
  enrollment: vi.fn(),
  accountMenu: vi.fn(),
  request: vi.fn(),
  updateUrl: vi.fn(),
  setupConnector: null as SearchConnector | null,
}))
vi.mock('@/app/o/[organizationId]/integrations/slack-search-actions', () => ({
  SlackSearchActions: () => <span>Return to Slack</span>,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/search-integration-connection',
  () => ({
    SearchIntegrationConnection: (props: unknown) => {
      mocks.request(props)
      return <span>Requested connection</span>
    },
  })
)
vi.mock('@/hooks/queries/personal-search-integrations', () => ({
  usePersonalSearchIntegrations: mocks.slackInventory,
}))
vi.mock('@/hooks/queries/search-integrations', () => ({
  useSearchIntegrations: mocks.integrations,
}))
vi.mock('@/hooks/use-permission-config', () => ({ usePermissionConfig: mocks.availability }))
vi.mock('@/app/o/[organizationId]/components/organization-page', () => ({
  OrganizationPage: ({ action, children }: { action?: ReactNode; children?: ReactNode }) => (
    <>
      {action}
      {children}
    </>
  ),
}))
vi.mock(
  '@/app/o/[organizationId]/components/organization-page/use-organization-page-filters',
  () => ({ useOrganizationPageFilters: mocks.filters })
)
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: mocks.context,
}))
vi.mock('@/app/workspace/[workspaceId]/integrations/components/integrations-showcase', () => ({
  IntegrationTile: () => null,
}))
vi.mock('@/app/o/[organizationId]/integrations/disconnect-account-menu', () => ({
  DisconnectAccountMenu: (props: {
    integrationName: string
    accounts: { credentialId: string }[]
    actions?: RowAction[]
  }) => {
    mocks.accountMenu(props)
    const actions = [
      ...(props.actions ?? []),
      ...props.accounts.map((account) => ({
        label: `Disconnect ${account.credentialId}`,
        onSelect: vi.fn(),
      })),
    ]
    return actions.length ? (
      <RowActionsMenu label={`${props.integrationName} integration actions`} actions={actions} />
    ) : null
  },
}))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  useSearchSources: mocks.sources,
  useSearchSourceOverview: mocks.overview,
}))
vi.mock('@/hooks/use-member-enrollment', () => ({
  enrollmentActionLabel: (membership: string, waiting: boolean) =>
    waiting ? 'Open again' : membership === 'needs_reauth' ? 'Reconnect' : 'Connect',
  CONNECTABLE_MEMBERSHIPS: new Set(['invited', 'not_enrolled', 'needs_reauth']),
  useMemberEnrollment: (options: unknown) => {
    mocks.enrollment(options)
    return {
      connect: mocks.connect,
      connectSearchSource: mocks.connectSearchSource,
      isAwaiting: () => false,
      isAwaitingSource: () => false,
      isPending: false,
      setupConnector: mocks.setupConnector,
      closeSetup: vi.fn(),
    }
  },
}))
vi.mock('@/hooks/use-oauth-return', () => ({
  useDesktopOAuthConnectListener: () => undefined,
  useOAuthReturnRouter: () => undefined,
}))

import { OrganizationIntegrations } from '@/app/o/[organizationId]/integrations/integrations'
import { MemberIntegrationsList } from '@/app/o/[organizationId]/integrations/member-integrations-list'
import {
  type RowAction,
  RowActionsMenu,
} from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { organizationAccountsKeys } from '@/hooks/queries/organization-accounts'

const scope = { kind: 'organization', organizationId: 'organization-a' } as const
const account = {
  credentialId: 'account',
  displayName: 'My work account',
  status: 'active' as const,
}
const memberSource: SearchSourceSummary = {
  knowledgeBaseId: 'search-index',
  connectorId: 'source-a',
  connectorType: 'gmail',
  sourceDescription: 'Inbox',
  accessMode: 'members',
  availability: 'available',
  enabled: true,
  isSyncing: false,
  lastSyncAt: null,
  hasSyncError: false,
  viewerDocumentCount: 0,
  viewerFailedDocumentCount: 0,
  viewerEmailVerified: true,
  viewerAccounts: [],
  connectionRequired: true,
  viewerMembership: 'not_enrolled',
  approved: true,
}
const centralSource: SearchSourceSummary = {
  ...memberSource,
  connectorId: 'central',
  connectorType: 'google_drive',
  sourceDescription: 'Shared Drive',
  accessMode: 'admin',
  connectionRequired: false,
  viewerMembership: null,
}

let root: Root
let container: HTMLDivElement
let rows: SearchSourceSummary[]
let queryOverrides: Record<string, unknown>
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(toast, 'error').mockReturnValue('toast')
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.setupConnector = null
  rows = [memberSource]
  queryOverrides = {}
  mocks.context.mockReturnValue({
    organization: { id: scope.organizationId },
    viewer: { isAdmin: false },
    searchAccess: { memberScoped: true, sourceMirrored: true },
  })
  mocks.filters.mockReturnValue({ search: '' })
  mocks.slackInventory.mockReturnValue({
    data: { available: [] },
    isPending: false,
    isError: false,
  })
  mocks.integrations.mockReturnValue({
    data: [{ connectorType: 'gmail', approved: true }],
    isPending: false,
  })
  mocks.overview.mockReturnValue({
    data: {
      providers: [{ connectorType: 'gmail', isSyncing: false }],
      hasSearchableDocuments: false,
    },
    isPending: false,
  })
  mocks.availability.mockReturnValue({
    integrationAvailability: new Map(),
    oauthServiceAvailability: new Map([
      ['google-email', true],
      ['confluence', true],
      ['jira', true],
    ]),
    isIntegrationAvailabilityReady: true,
    integrationAvailabilityError: null,
  })
  mocks.sources.mockImplementation(
    (_scope: unknown, options: { enabled: boolean; connectorType?: string }) => ({
      data: options.enabled
        ? rows.filter((row) => row.connectorType === options.connectorType)
        : undefined,
      isPending: false,
      isError: false,
      isFetching: false,
      isFetchNextPageError: false,
      hasNextPage: false,
      fetchNextPage: mocks.nextPage,
      refetch: mocks.refetch,
      ...queryOverrides,
    })
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function render(searchParams = '', element: ReactNode = <MemberIntegrationsList />) {
  await act(async () =>
    root.render(
      <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={mocks.updateUrl}>
        {element}
      </NuqsTestingAdapter>
    )
  )
}
function buttons(label: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(
    (button) => button.textContent?.trim() === label
  )
}

async function openMenu(name: string) {
  const trigger = document.querySelector<HTMLButtonElement>(
    `[aria-label="${name} integration actions"]`
  )!
  await act(async () =>
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  )
}
function menuItem(label: string) {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === label
  )!
}

describe('grouped member integrations', () => {
  it('renders one provider row and loads bounded pages per configured provider', async () => {
    mocks.overview.mockReturnValue({
      data: { providers: [{ connectorType: 'gmail' }, { connectorType: 'google_drive' }] },
      isPending: false,
    })
    rows = Array.from({ length: 25 }, (_, index) => ({
      ...memberSource,
      connectorId: `gmail-${index}`,
    }))
    await render()
    expect(buttons('Connect')).toHaveLength(1)
    expect(container.textContent).toContain('Google Drive')
    expect(container.textContent).not.toContain('Inbox')
    expect(mocks.sources).toHaveBeenCalledWith(scope, { connectorType: 'gmail', enabled: true })
    expect(mocks.sources).toHaveBeenCalledWith(scope, {
      connectorType: 'google_drive',
      enabled: true,
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it('keeps the list flat even when an old details URL is opened', async () => {
    rows = [
      memberSource,
      { ...memberSource, connectorId: 'source-b', sourceDescription: 'Archive' },
    ]
    await render('?integration=gmail')
    expect(document.querySelector('[role="region"]')).toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(container.textContent).not.toContain('Inbox')
    expect(container.textContent).not.toContain('Archive')
    expect(document.querySelector('[aria-label="Gmail integration actions"]')).toBeNull()
    expect(buttons('Connect')).toHaveLength(1)
  })
  it('connects one configured target even with many same-provider content scopes', async () => {
    rows = [
      memberSource,
      { ...memberSource, connectorId: 'source-b', sourceDescription: 'Archive' },
    ]
    await render('?integration=gmail')
    expect(buttons('Connect')).toHaveLength(1)
    await act(async () => buttons('Connect')[0].click())
    expect(mocks.connect).toHaveBeenCalledExactlyOnceWith('search-index', 'source-a')
  })
  it('deduplicates the same account across scopes', async () => {
    rows = [memberSource, { ...memberSource, connectorId: 'source-b' }].map((source) => ({
      ...source,
      viewerMembership: 'connected',
      viewerAccounts: [account],
    }))
    await render('?integration=gmail')
    expect(mocks.accountMenu).toHaveBeenCalledWith(expect.objectContaining({ accounts: [account] }))
    expect(buttons('Connect')).toHaveLength(0)
    expect(buttons('Reconnect')).toHaveLength(0)
    expect(container.textContent).toContain('Connected')
  })
  it.each(['personal', 'central'] as const)(
    'keeps existing %s content connected when another source needs authorization',
    async (kind) => {
      const connected: SearchSourceSummary =
        kind === 'personal'
          ? { ...memberSource, viewerMembership: 'connected', viewerAccounts: [account] }
          : { ...centralSource, connectorType: 'gmail' }
      rows = [connected, { ...memberSource, connectorId: 'additional-source' }]
      await render()
      expect(container.textContent).toContain('Additional connection required')
      expect(container.textContent).not.toContain('Not connected')
      expect(buttons('Connect')).toHaveLength(1)
      expect(buttons('Reconnect')).toHaveLength(0)
      await act(async () => buttons('Connect')[0].click())
      expect(mocks.connect).toHaveBeenCalledExactlyOnceWith('search-index', 'additional-source')
    }
  )
  it('does not ask for authorization again when connected content fails to sync', async () => {
    rows = [memberSource, { ...memberSource, connectorId: 'source-b' }].map((source) => ({
      ...source,
      viewerMembership: 'connected',
      viewerAccounts: [account],
      hasSyncError: true,
    }))
    await render()
    expect(container.textContent).toContain('Sync needs attention')
    expect(buttons('Connect')).toHaveLength(0)
    expect(buttons('Reconnect')).toHaveLength(0)
  })
  it('reconnects the expired target before any connected account', async () => {
    rows = [
      { ...memberSource, viewerMembership: 'connected', viewerAccounts: [account] },
      {
        ...memberSource,
        connectorId: 'expired-source',
        viewerMembership: 'needs_reauth',
        viewerAccounts: [{ ...account, credentialId: 'expired-account', status: 'needs_reauth' }],
      },
      { ...memberSource, connectorId: 'unconnected-source' },
    ]
    await render('?integration=gmail')
    await act(async () => buttons('Reconnect')[0].click())
    expect(mocks.connect).toHaveBeenCalledExactlyOnceWith('search-index', 'expired-source')
  })
  it('explains central connections without asking for a personal account', async () => {
    mocks.overview.mockReturnValue({
      data: { providers: [{ connectorType: 'google_drive', isSyncing: false }] },
      isPending: false,
    })
    mocks.integrations.mockReturnValue({
      data: [{ connectorType: 'google_drive', approved: true }],
      isPending: false,
    })
    rows = [centralSource]
    await render('?integration=google_drive')
    expect(container.textContent).toContain('Google Drive')
    expect(buttons('Connect')).toHaveLength(0)
  })
  it.each([{ enabled: false }, { approved: false }, { availability: 'unavailable' as const }])(
    'retains own-account removal when a source cannot connect: %o',
    async (override) => {
      rows = [
        {
          ...memberSource,
          viewerMembership: 'needs_reauth',
          viewerAccounts: [account],
          ...override,
        },
      ]
      await render('?integration=gmail')
      expect(mocks.accountMenu).toHaveBeenCalledWith(
        expect.objectContaining({ accounts: [account] })
      )
      expect(buttons('Reconnect')).toHaveLength(0)
    }
  )
  it.each(['members', 'admin'] as const)(
    'does not claim connected when multi-scope %s access is disabled',
    async (accessMode) => {
      mocks.context.mockReturnValue({
        organization: { id: scope.organizationId },
        searchAccess: { memberScoped: false, sourceMirrored: false },
      })
      rows = [memberSource, { ...memberSource, connectorId: 'source-b' }].map((source) => ({
        ...source,
        accessMode,
        isSyncing: true,
        viewerMembership: 'connected',
        viewerAccounts: [account],
      }))
      await render()
      expect(container.textContent).toContain('Some connections need attention')
      expect(container.textContent).not.toContain('Indexing')
      expect(buttons('Connect')).toHaveLength(0)
      expect(mocks.accountMenu).toHaveBeenCalledWith(
        expect.objectContaining({ accounts: [account] })
      )
    }
  )
  it('keeps email verification as account recovery and returns to the integration list', async () => {
    rows = [{ ...memberSource, viewerEmailVerified: false, viewerMembership: 'unverified_email' }]
    await render()
    expect(container.textContent).toContain('Verify your email')
    expect(buttons('Connect')).toHaveLength(0)
    const recovery = container.querySelector<HTMLAnchorElement>('a[href^="/verify"]')!
    expect(new URL(recovery.href).searchParams.get('redirectAfter')).toBe(
      '/o/organization-a/integrations'
    )
  })
  it.each([{ enabled: false }, { approved: false }, { availability: 'unavailable' as const }])(
    'does not offer verification for blocked content: %o',
    async (override) => {
      rows = [memberSource, { ...memberSource, connectorId: 'source-b' }].map((source) => ({
        ...source,
        ...override,
        viewerEmailVerified: false,
        viewerMembership: 'unverified_email',
      }))
      await render()
      expect(container.querySelector('a[href^="/verify"]')).toBeNull()
      expect(container.textContent).toContain('Some connections need attention')
      expect(buttons('Connect')).toHaveLength(0)
    }
  )
  it('preserves explicit pagination instead of pretending loaded scope counts are complete', async () => {
    queryOverrides = { hasNextPage: true }
    rows = []
    await render('?integration=gmail')
    await openMenu('Gmail')
    await act(async () => menuItem('Load more connections').click())
    expect(mocks.nextPage).toHaveBeenCalledOnce()
    expect(buttons('Connect')).toHaveLength(0)
  })
  it('retries a failed connection read directly from its flat row', async () => {
    queryOverrides = { isError: true, error: new Error('Could not load') }
    await render()
    expect(buttons('Connect')).toHaveLength(0)
    expect(document.querySelector('[role="region"]')).toBeNull()
    await act(async () => buttons('Retry')[0].click())
    expect(mocks.refetch).toHaveBeenCalledOnce()
  })
  it('keeps later connection pages retryable without an expanded section', async () => {
    queryOverrides = { hasNextPage: true, isError: true, isFetchNextPageError: true }
    rows = []
    await render()
    await openMenu('Gmail')
    await act(async () => menuItem('Retry loading connections').click())
    expect(mocks.nextPage).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="region"]')).toBeNull()
  })
  it('offers direct Connect only for a new eligible provider, with no duplicate scope row', async () => {
    mocks.overview.mockReturnValue({ data: { providers: [] }, isPending: false })
    await render()
    expect(buttons('Connect')).toHaveLength(1)
    await act(async () => buttons('Connect')[0].click())
    expect(mocks.connectSearchSource).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ type: 'gmail' }),
      undefined
    )
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it.each([false, true])(
    'preserves shared Slack onboarding without a duplicate row (configured: %s)',
    async (configured) => {
      mocks.overview.mockReturnValue({
        data: { providers: configured ? [{ connectorType: 'slack' }] : [] },
        isPending: false,
      })
      mocks.integrations.mockReturnValue({
        data: [{ connectorType: 'slack', approved: true }],
        isPending: false,
      })
      mocks.availability.mockReturnValue({
        integrationAvailability: new Map([['slack_v2', { state: 'ready', oauthAvailable: true }]]),
        oauthServiceAvailability: new Map([['slack', true]]),
        isIntegrationAvailabilityReady: true,
      })
      mocks.slackInventory.mockReturnValue({
        data: { available: [{ target: { connectorType: 'slack' } }] },
        isPending: false,
        isError: false,
      })
      rows = configured ? [{ ...memberSource, connectorType: 'slack' }] : []
      await render()
      expect(buttons('Connect')).toHaveLength(1)
      expect(mocks.slackInventory).toHaveBeenCalledWith({
        organizationId: scope.organizationId,
        connectorType: 'slack',
      })
      await act(async () => buttons('Connect')[0].click())
      if (configured) {
        expect(mocks.connect).toHaveBeenCalledExactlyOnceWith('search-index', 'source-a')
        expect(mocks.connectSearchSource).not.toHaveBeenCalled()
      } else {
        expect(mocks.connectSearchSource).toHaveBeenCalledExactlyOnceWith(
          scope,
          expect.objectContaining({ type: 'slack' }),
          undefined
        )
        expect(mocks.connect).not.toHaveBeenCalled()
      }
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    }
  )
  it.each([
    { data: { available: [] }, isPending: false, isError: false },
    {
      data: { available: [{ target: { connectorType: 'slack', connectorId: 'existing' } }] },
      isPending: false,
      isError: false,
    },
    { data: undefined, isPending: true, isError: false },
    { data: undefined, isPending: false, isError: true, error: new Error('Could not load Slack') },
  ])('withholds new Slack setup without a ready shared-app target: %o', async (inventory) => {
    mocks.overview.mockReturnValue({ data: { providers: [] }, isPending: false })
    mocks.integrations.mockReturnValue({
      data: [{ connectorType: 'slack', approved: true }],
      isPending: false,
    })
    mocks.availability.mockReturnValue({
      integrationAvailability: new Map([['slack_v2', { state: 'ready', oauthAvailable: true }]]),
      oauthServiceAvailability: new Map([['slack', true]]),
      isIntegrationAvailabilityReady: true,
    })
    mocks.slackInventory.mockReturnValue(inventory)
    await render()
    expect(buttons('Connect')).toHaveLength(0)
    expect(mocks.connectSearchSource).not.toHaveBeenCalled()
  })
  it('withholds new setup on failed/incomplete provider data', async () => {
    mocks.overview.mockReturnValue({
      data: { providers: [{ connectorType: 'confluence', isSyncing: false }] },
      isPending: false,
    })
    mocks.integrations.mockReturnValue({
      data: [{ connectorType: 'confluence', approved: true }],
      isPending: false,
    })
    rows = [{ ...memberSource, connectorType: 'confluence' }]
    queryOverrides = { isError: true, error: new Error('Could not load'), hasNextPage: false }
    await render('?integration=confluence')
    expect(
      mocks.accountMenu.mock.calls.at(-1)?.[0].actions.map((action: RowAction) => action.label)
    ).toEqual([])
    queryOverrides = { hasNextPage: true }
    await render('?integration=confluence')
    expect(
      mocks.accountMenu.mock.calls.at(-1)?.[0].actions.map((action: RowAction) => action.label)
    ).toEqual(['Load more connections'])
  })
  it('keeps the integration menu open during background indexing refreshes', async () => {
    mocks.overview.mockReturnValue({
      data: { providers: [{ connectorType: 'confluence', isSyncing: true }] },
      isPending: false,
    })
    mocks.integrations.mockReturnValue({
      data: [{ connectorType: 'confluence', approved: true }],
      isPending: false,
    })
    rows = [{ ...memberSource, connectorType: 'confluence' }]
    await render('?integration=confluence')
    const trigger = document.querySelector<HTMLButtonElement>(
      '[aria-label="Confluence integration actions"]'
    )!
    await act(async () =>
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    )
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    queryOverrides = { isFetching: true }
    await render('?integration=confluence')
    expect(document.querySelector('[aria-label="Confluence integration actions"]')).toBe(trigger)
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
  })
  it('retains typed connection requests and Slack onboarding on the main page', async () => {
    const connectionRequest = {
      userId: 'person',
      target: {
        type: 'link' as const,
        provider: 'google-email',
        connectorType: 'gmail',
        connectorId: 'source-a',
      },
    }
    await render(
      '',
      <OrganizationIntegrations
        connectionRequest={connectionRequest}
        slackOnboarding={{ token: 'onboarding', userId: 'person' }}
      />
    )
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ ...connectionRequest, organizationId: scope.organizationId })
    )
    expect(container.textContent).toContain('Return to Slack')
  })
  it('keeps scoped enrollment invalidations and toast error handling', async () => {
    await render('?integration=gmail')
    const options = mocks.enrollment.mock.calls.at(-1)?.[0] as {
      membershipQueryKeys: unknown[]
      onConnectionError: (message: string) => void
    }
    expect(options.membershipQueryKeys).toContainEqual(
      organizationAccountsKeys.detail(scope.organizationId)
    )
    options.onConnectionError('Choose the matching account')
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Choose the matching account')
    expect(document.body.textContent).not.toContain('Choose the matching account')
  })
})
