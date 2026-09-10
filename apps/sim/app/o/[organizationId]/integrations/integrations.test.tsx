/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchSourceSummary } from '@/lib/api/contracts/knowledge/connectors'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  sources: vi.fn(),
  overview: vi.fn(),
  integrations: vi.fn(),
  filters: vi.fn(),
  setSource: vi.fn(),
  connect: vi.fn(),
  availability: vi.fn(),
  refetchAvailability: vi.fn(),
  enrollment: vi.fn(),
}))

vi.mock('@/app/o/[organizationId]/integrations/slack-search-actions', () => ({
  SlackSearchActions: ({ token }: { token: string }) => <button type='button'>{token}</button>,
}))
vi.mock('@/hooks/queries/search-integrations', () => ({
  useSearchIntegrations: mocks.integrations,
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: mocks.availability,
}))
vi.mock('nuqs', () => ({
  useQueryState: () => [null, mocks.setSource],
  parseAsString: { withOptions: () => ({}) },
  parseAsStringLiteral: () => ({ withOptions: () => ({}) }),
}))
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
  () => ({
    useOrganizationPageFilters: mocks.filters,
  })
)
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: mocks.context,
}))
vi.mock('@/app/workspace/[workspaceId]/integrations/components/integrations-showcase', () => ({
  IntegrationTile: () => null,
}))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  useSearchSources: mocks.sources,
  useSearchSourceOverview: mocks.overview,
}))
vi.mock('@/hooks/use-member-enrollment', () => ({
  CONNECTABLE_MEMBERSHIPS: new Set(['invited', 'not_enrolled', 'needs_reauth']),
  useMemberEnrollment: (options: unknown) => {
    mocks.enrollment(options)
    return {
      connect: mocks.connect,
      connectSearchSource: mocks.connect,
      isAwaiting: () => false,
      isPending: false,
      error: null,
    }
  },
}))
vi.mock('@/hooks/use-oauth-return', () => ({
  useDesktopOAuthConnectListener: () => undefined,
  useOAuthReturnRouter: () => undefined,
}))

import { ConnectAccountOptions } from '@/app/o/[organizationId]/integrations/connect-account-options'
import { OrganizationIntegrations } from '@/app/o/[organizationId]/integrations/integrations'
import { organizationAccountsKeys } from '@/hooks/queries/organization-accounts'

const scope = { kind: 'organization', organizationId: 'organization-a' } as const
const memberSource: SearchSourceSummary = {
  knowledgeBaseId: 'search-index',
  connectorId: 'member-source',
  connectorType: 'gmail',
  sourceDescription: 'Gmail',
  accessMode: 'members',
  availability: 'available',
  enabled: true,
  isSyncing: false,
  lastSyncAt: null,
  hasSyncError: false,
  viewerDocumentCount: 0,
  viewerEmailVerified: true,
  connectionRequired: true,
  viewerMembership: 'not_enrolled',
}
const centralSource: SearchSourceSummary = {
  ...memberSource,
  connectorId: 'central-source',
  connectorType: 'google_drive',
  sourceDescription: 'Engineering',
  accessMode: 'admin',
  viewerDocumentCount: 4,
  connectionRequired: false,
  viewerMembership: null,
}

describe('organization integrations role and source paths', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.context.mockReturnValue({
      organization: { id: scope.organizationId },
      viewer: { isAdmin: false },
      searchAccess: { memberScoped: true, sourceMirrored: true },
    })
    mocks.integrations.mockReturnValue({ data: [], isPending: false })
    mocks.availability.mockReturnValue({
      integrationAvailability: new Map(),
      oauthServiceAvailability: new Map([
        ['google-email', true],
        ['confluence', true],
        ['jira', true],
      ]),
      isIntegrationAvailabilityReady: true,
      integrationAvailabilityError: null,
      isIntegrationAvailabilityFetching: false,
      refetchIntegrationAvailability: mocks.refetchAvailability,
    })
    mocks.sources.mockReturnValue({ data: [memberSource, centralSource], isPending: false })
    mocks.overview.mockReturnValue({
      data: {
        providers: [
          { connectorType: 'gmail', isSyncing: false },
          { connectorType: 'google_drive', isSyncing: false },
        ],
        hasSearchableDocuments: false,
      },
      isPending: false,
    })
    mocks.filters.mockReturnValue({ tab: null, search: '', setSearch: vi.fn() })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    vi.useRealTimers()
    container.remove()
    vi.unstubAllGlobals()
  })

  async function render() {
    await act(async () => root.render(<ConnectAccountOptions />))
  }

  function buttons(label: string) {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(
      (button) => button.textContent?.trim() === label
    )
  }

  it('uses the actual organization and only asks members to connect identity-dependent sources', async () => {
    await render()
    expect(mocks.sources).toHaveBeenCalledWith(scope, { search: '' })
    expect(buttons('Add source')).toHaveLength(0)
    expect(buttons('Manage')).toHaveLength(0)
    expect(buttons('Connect')).toHaveLength(1)
    expect(document.body.textContent).not.toContain('Engineering')
    await act(async () => buttons('Connect')[0].click())
    expect(mocks.connect).toHaveBeenCalledExactlyOnceWith('search-index', 'member-source')
  })

  it('keeps Slack return actions alongside personal connection controls', async () => {
    mocks.context.mockReturnValue({
      organization: { id: scope.organizationId },
      viewer: { isAdmin: true },
      searchAccess: { memberScoped: true, sourceMirrored: true },
    })
    await act(async () =>
      root.render(
        <OrganizationIntegrations slackOnboarding={{ token: 'slack-return', userId: 'member' }} />
      )
    )
    expect(document.body.textContent).not.toContain('Your accounts')
    expect(document.body.textContent).not.toContain('Manage sources')
    expect(buttons('slack-return')).toHaveLength(1)
  })

  it('always requests personal connections even with an old All tab URL', async () => {
    vi.useFakeTimers()
    await act(async () => root.render(<OrganizationIntegrations />))
    mocks.filters.mockReturnValue({ tab: 'all', search: ' drive ', setSearch: vi.fn() })
    await act(async () => root.render(<OrganizationIntegrations />))
    expect(mocks.sources).toHaveBeenCalledWith(scope, { search: '', mine: true })
    await act(async () => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS))
    expect(mocks.sources).toHaveBeenCalledWith(scope, { search: 'drive', mine: true })
  })

  it('refreshes organization Accounts after either direct connection flow completes', async () => {
    await act(async () => root.render(<OrganizationIntegrations />))
    expect(mocks.enrollment.mock.calls.length).toBeGreaterThanOrEqual(2)
    for (const [options] of mocks.enrollment.mock.calls) {
      expect(options).toMatchObject({
        directOAuth: true,
        membershipQueryKeys: expect.arrayContaining([
          organizationAccountsKeys.detail(scope.organizationId),
        ]),
      })
    }
  })

  it('offers an approved integration before any source is configured', async () => {
    mocks.sources.mockReturnValue({ data: [], isPending: false })
    mocks.overview.mockReturnValue({
      data: { providers: [], hasSearchableDocuments: false },
      isPending: false,
    })
    mocks.integrations.mockReturnValue({
      data: [{ connectorType: 'gmail', approved: true }],
      isPending: false,
    })
    await render()
    expect(document.body.textContent).toContain('Connect your account to search this source')
    expect(buttons('Connect')).toHaveLength(1)
    await act(async () => buttons('Connect')[0].click())
    expect(mocks.connect).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ type: 'gmail' }),
      undefined
    )
  })
  it('allows a second approved content scope after another source is configured', async () => {
    mocks.sources.mockReturnValue({
      data: [{ ...memberSource, connectorType: 'confluence', sourceDescription: 'ENG' }],
      isPending: false,
    })
    mocks.overview.mockReturnValue({
      data: { providers: [{ connectorType: 'confluence' }] },
      isPending: false,
    })
    mocks.integrations.mockReturnValue({
      data: [{ connectorType: 'confluence', approved: true }],
      isPending: false,
    })
    mocks.availability.mockReturnValue({
      integrationAvailability: new Map(),
      oauthServiceAvailability: new Map([['confluence', true]]),
      isIntegrationAvailabilityReady: true,
    })
    await render()
    expect(buttons('Connect')).toHaveLength(2)
    await act(async () => buttons('Connect')[1].click())
    expect(mocks.connect).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ type: 'confluence' }),
      undefined
    )
  })

  it('keeps configured sources in alphabetical order with approved providers', async () => {
    mocks.sources.mockReturnValue({ data: [memberSource], isPending: false })
    mocks.integrations.mockReturnValue({
      data: [
        { connectorType: 'confluence', approved: true },
        { connectorType: 'jira', approved: true },
      ],
      isPending: false,
    })
    await render()
    const text = container.textContent ?? ''
    expect(text.indexOf('Confluence')).toBeLessThan(text.indexOf('Gmail'))
    expect(text.indexOf('Gmail')).toBeLessThan(text.indexOf('Jira'))
  })

  it('withholds connection when an integration is deactivated', async () => {
    mocks.sources.mockReturnValue({
      data: [{ ...memberSource, approved: false }],
      isPending: false,
    })
    await render()
    expect(buttons('Connect')).toHaveLength(0)
    expect(document.body.textContent).not.toContain('Gmail')
  })
  it('waits for availability before describing approved sources as needing admin setup', async () => {
    mocks.sources.mockReturnValue({ data: [], isPending: false })
    mocks.overview.mockReturnValue({
      data: { providers: [], hasSearchableDocuments: false },
      isPending: false,
    })
    mocks.integrations.mockReturnValue({
      data: [{ connectorType: 'gmail', approved: true }],
      isPending: false,
    })
    mocks.availability.mockReturnValue({ isIntegrationAvailabilityReady: false })
    await render()
    expect(document.body.textContent).toContain('Loading sources')
    expect(document.body.textContent).not.toContain('An admin needs to finish source setup')
    expect(buttons('Connect')).toHaveLength(0)
  })

  it('retries availability failures instead of asking an admin to finish setup', async () => {
    mocks.sources.mockReturnValue({ data: [], isPending: false })
    mocks.overview.mockReturnValue({
      data: { providers: [], hasSearchableDocuments: false },
      isPending: false,
    })
    mocks.integrations.mockReturnValue({
      data: [{ connectorType: 'gmail', approved: true }],
      isPending: false,
    })
    mocks.availability.mockReturnValue({
      isIntegrationAvailabilityReady: false,
      integrationAvailabilityError: new Error('Connection availability failed'),
      refetchIntegrationAvailability: mocks.refetchAvailability,
      isIntegrationAvailabilityFetching: false,
    })
    await render()
    expect(document.body.textContent).toContain('Connection availability failed')
    expect(document.body.textContent).not.toContain('An admin needs to finish source setup')
    expect(buttons('Connect')).toHaveLength(0)
    await act(async () => buttons('Try again')[0].click())
    expect(mocks.refetchAvailability).toHaveBeenCalledOnce()
  })
  it('hides Slack until its organization setup is ready', async () => {
    mocks.sources.mockReturnValue({ data: [], isPending: false })
    mocks.overview.mockReturnValue({
      data: { providers: [], hasSearchableDocuments: false },
      isPending: false,
    })
    mocks.integrations.mockReturnValue({
      data: [{ connectorType: 'slack', approved: true }],
      isPending: false,
    })
    await render()
    expect(buttons('Connect')).toHaveLength(0)
    expect(document.body.textContent).not.toContain('Slack')
    expect(document.body.textContent).toContain('No integrations are available to connect.')
  })

  it('hides an approved provider when its OAuth configuration is missing', async () => {
    mocks.sources.mockReturnValue({ data: [], isPending: false })
    mocks.overview.mockReturnValue({ data: { providers: [] }, isPending: false })
    mocks.integrations.mockReturnValue({
      data: [{ connectorType: 'gmail', approved: true }],
      isPending: false,
    })
    mocks.availability.mockReturnValue({
      integrationAvailability: new Map(),
      oauthServiceAvailability: new Map([['google-email', false]]),
      isIntegrationAvailabilityReady: true,
    })
    await render()
    expect(document.body.textContent).not.toContain('Gmail')
    expect(buttons('Connect')).toHaveLength(0)
    expect(document.body.textContent).toContain('No integrations are available to connect.')
  })

  it('offers personal Slack connection once source setup is complete', async () => {
    mocks.sources.mockReturnValue({
      data: [{ ...memberSource, connectorType: 'slack', accessMode: 'admin' }],
      isPending: false,
    })
    await render()
    expect(document.body.textContent).toContain('Slack')
    expect(buttons('Connect')).toHaveLength(1)
    expect(document.body.textContent).not.toContain('Finish Slack setup')
    await act(async () => buttons('Connect')[0].click())
    expect(mocks.connect).toHaveBeenCalledExactlyOnceWith('search-index', 'member-source')
  })
  it('also hides unfinished Slack setup from admins on this personal surface', async () => {
    mocks.context.mockReturnValue({
      organization: { id: scope.organizationId },
      viewer: { isAdmin: true },
      searchAccess: { memberScoped: true, sourceMirrored: true },
    })
    mocks.sources.mockReturnValue({ data: [], isPending: false })
    mocks.overview.mockReturnValue({ data: { providers: [] }, isPending: false })
    mocks.integrations.mockReturnValue({
      data: [{ connectorType: 'slack', approved: true }],
      isPending: false,
    })
    await render()
    expect(
      document.querySelector('a[href="/o/organization-a/settings/integrations/providers/slack"]')
    ).toBeNull()
    expect(document.body.textContent).not.toContain('An admin needs to finish source setup')
    expect(buttons('Connect')).toHaveLength(0)
  })

  it('keeps source administration off the personal page for admins', async () => {
    mocks.context.mockReturnValue({
      organization: { id: scope.organizationId },
      viewer: { isAdmin: true },
      searchAccess: { memberScoped: true, sourceMirrored: true },
    })
    mocks.sources.mockReturnValue({
      data: [{ ...memberSource, viewerMembership: 'connected' }],
      isPending: false,
    })
    await act(async () => root.render(<OrganizationIntegrations />))
    expect(document.body.textContent).not.toContain('Manage sources')
    expect(document.querySelector('a[href="/account/settings/connected-accounts"]')).toBeNull()
    expect(document.querySelector('[aria-label$="source actions"]')).toBeNull()
    expect(buttons('Connect')).toHaveLength(0)
  })

  it('shows ready integrations inline and connects without an intermediate dialog', async () => {
    mocks.sources.mockReturnValue({ data: [], isPending: false })
    mocks.integrations.mockReturnValue({
      data: [{ connectorType: 'gmail', approved: true }],
      isPending: false,
    })
    mocks.overview.mockReturnValue({ data: { providers: [] }, isPending: false })
    await act(async () => root.render(<OrganizationIntegrations />))
    expect(mocks.sources).toHaveBeenCalledWith(scope, { search: '', mine: true })
    expect(document.body.textContent).toContain('Gmail')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(buttons('Connect account')).toHaveLength(0)
    await act(async () => buttons('Connect')[0].click())
    expect(mocks.connect).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ type: 'gmail' }),
      undefined
    )
  })

  it('filters available providers using the same search as personal connections', async () => {
    mocks.sources.mockReturnValue({ data: [], isPending: false })
    mocks.integrations.mockReturnValue({
      data: [
        { connectorType: 'gmail', approved: true },
        { connectorType: 'jira', approved: true },
      ],
      isPending: false,
    })
    mocks.overview.mockReturnValue({ data: { providers: [] }, isPending: false })
    await act(async () => root.render(<ConnectAccountOptions search='gmail' />))
    expect(document.body.textContent).toContain('Gmail')
    expect(document.body.textContent).not.toContain('Jira')
    expect(mocks.sources).toHaveBeenCalledWith(scope, { search: 'gmail' })
  })

  it('lets the viewer reconnect their own expired account from the main page', async () => {
    mocks.sources.mockReturnValue({
      data: [{ ...memberSource, viewerMembership: 'needs_reauth' }],
      isPending: false,
    })
    await act(async () => root.render(<OrganizationIntegrations />))
    expect(document.body.textContent).toContain('Your account needs to be reconnected')
    await act(async () => buttons('Reconnect')[0].click())
    expect(mocks.connect).toHaveBeenCalledExactlyOnceWith('search-index', 'member-source')
  })

  it('does not offer connection to an unavailable source or setup to a member with no sources', async () => {
    mocks.context.mockReturnValue({
      organization: { id: scope.organizationId },
      viewer: { isAdmin: false },
      searchAccess: { memberScoped: false, sourceMirrored: false },
    })
    await render()
    expect(buttons('Connect')).toHaveLength(0)
    expect(document.body.textContent).not.toContain('Gmail')
    mocks.sources.mockReturnValue({ data: [], isPending: false })
    mocks.overview.mockReturnValue({
      data: { providers: [], hasSearchableDocuments: false },
      isPending: false,
    })
    await render()
    expect(document.body.textContent).toContain('No integrations are available to connect.')
    expect(buttons('Add source')).toHaveLength(0)
  })
  it('keeps sparse source pages navigable without claiming missing sources or duplicating configured providers', async () => {
    const fetchNextPage = vi.fn()
    mocks.sources.mockReturnValue({ data: [], isPending: false, hasNextPage: true, fetchNextPage })
    mocks.integrations.mockReturnValue({
      data: [{ connectorType: 'gmail', approved: true }],
      isPending: false,
    })
    await render()
    expect(buttons('Load more')).toHaveLength(1)
    expect(buttons('Connect')).toHaveLength(0)
    expect(document.body.textContent).not.toContain('hasn’t added any sources')
    await act(async () => buttons('Load more')[0].click())
    expect(fetchNextPage).toHaveBeenCalledOnce()
  })

  it('retains loaded rows on a next-page failure and retries only that page', async () => {
    const fetchNextPage = vi.fn()
    mocks.sources.mockReturnValue({
      data: [{ ...memberSource, sourceDescription: 'Engineering' }],
      isPending: false,
      isError: true,
      isFetchNextPageError: true,
      hasNextPage: true,
      error: new Error('Could not load more sources'),
      fetchNextPage,
    })
    await render()
    expect(document.body.textContent).toContain('Engineering')
    expect(document.body.textContent).toContain('Could not load more sources')
    await act(async () => buttons('Try again')[0].click())
    expect(fetchNextPage).toHaveBeenCalledOnce()
  })
})
