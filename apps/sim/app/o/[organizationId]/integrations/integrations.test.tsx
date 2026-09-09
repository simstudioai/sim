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
  searchSourceKeys: { list: (scope: unknown) => ['sources', scope] },
}))
vi.mock('@/hooks/use-member-enrollment', () => ({
  CONNECTABLE_MEMBERSHIPS: new Set(['invited', 'not_enrolled', 'needs_reauth']),
  useMemberEnrollment: () => ({
    connect: mocks.connect,
    connectSearchSource: mocks.connect,
    isAwaiting: () => false,
    isPending: false,
    error: null,
  }),
}))
vi.mock('@/hooks/use-oauth-return', () => ({
  useDesktopOAuthConnectListener: () => undefined,
  useOAuthReturnRouter: () => undefined,
}))

import { OrganizationIntegrations } from '@/app/o/[organizationId]/integrations/integrations'

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
      oauthServiceAvailability: new Map([['google-email', true]]),
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
    await act(async () => root.render(<OrganizationIntegrations />))
  }

  function buttons(label: string) {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(
      (button) => button.textContent?.trim() === label
    )
  }

  it('uses the actual organization and only asks members to connect identity-dependent sources', async () => {
    await render()
    expect(mocks.sources).toHaveBeenCalledWith(scope, { search: '', mine: false })
    expect(buttons('Add source')).toHaveLength(0)
    expect(buttons('Manage')).toHaveLength(0)
    expect(buttons('Connect account')).toHaveLength(1)
    expect(document.body.textContent).toContain('4 searchable documents')
    await act(async () => buttons('Connect account')[0].click())
    expect(mocks.connect).toHaveBeenCalledExactlyOnceWith('search-index', 'member-source')
  })

  it('debounces server search while applying the selected tab immediately', async () => {
    vi.useFakeTimers()
    await render()
    mocks.filters.mockReturnValue({ tab: 'mine', search: ' drive ', setSearch: vi.fn() })
    await render()
    expect(mocks.sources).toHaveBeenLastCalledWith(scope, { search: '', mine: true })
    await act(async () => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS))
    expect(mocks.sources).toHaveBeenLastCalledWith(scope, { search: 'drive', mine: true })
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
    expect(buttons('Connect account')).toHaveLength(1)
    await act(async () => buttons('Connect account')[0].click())
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
    expect(buttons('Add source')).toHaveLength(1)
    await act(async () => buttons('Add source')[0].click())
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
    expect(buttons('Connect account')).toHaveLength(0)
    expect(document.body.textContent).toContain('Deactivated by an organization admin')
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
    expect(buttons('Connect account')).toHaveLength(0)
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
    expect(buttons('Connect account')).toHaveLength(0)
    await act(async () => buttons('Try again')[0].click())
    expect(mocks.refetchAvailability).toHaveBeenCalledOnce()
  })
  it('asks an admin to configure Slack before members can connect an approved source', async () => {
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
    expect(buttons('Connect account')).toHaveLength(0)
    expect(document.body.textContent).toContain('An admin needs to finish source setup')
  })
  it('keeps personal rows consistent for admins and directs management through Sources', async () => {
    mocks.context.mockReturnValue({
      organization: { id: scope.organizationId },
      viewer: { isAdmin: true },
      searchAccess: { memberScoped: true, sourceMirrored: true },
    })
    await render()
    expect(
      document.querySelector(
        'a[href="/o/organization-a/settings/integrations/sources/member-source"]'
      )
    ).toBeNull()
    expect(
      document.querySelector('a[href="/o/organization-a/settings/integrations"]')
    ).toHaveTextContent('Manage sources')
    expect(document.querySelector('a[href="/account/settings/connected-accounts"]')).not.toBeNull()
    expect(buttons('Add source')).toHaveLength(0)
    expect(buttons('Manage')).toHaveLength(0)
    expect(document.querySelector('[aria-label$="source actions"]')).toBeNull()
    expect(buttons('Connect account')).toHaveLength(1)
  })

  it('lists only the sources the viewer connected under Mine', async () => {
    mocks.filters.mockReturnValue({ tab: 'mine', search: '', setSearch: vi.fn() })
    mocks.sources.mockReturnValue({ data: [], isPending: false })
    await render()
    expect(mocks.sources).toHaveBeenCalledWith(scope, { search: '', mine: true })
    expect(document.body.textContent).toContain('You haven’t connected any sources yet.')
    mocks.sources.mockReturnValue({
      data: [{ ...memberSource, viewerMembership: 'connected' }],
      isPending: false,
    })
    await render()
    expect(document.body.textContent).toContain('Gmail')
    expect(document.body.textContent).not.toContain('Engineering')
  })

  it('does not offer connection to an unavailable source or setup to a member with no sources', async () => {
    mocks.context.mockReturnValue({
      organization: { id: scope.organizationId },
      viewer: { isAdmin: false },
      searchAccess: { memberScoped: false, sourceMirrored: false },
    })
    await render()
    expect(buttons('Connect account')).toHaveLength(0)
    expect(document.body.textContent).toContain('Not available in this organization')
    mocks.sources.mockReturnValue({ data: [], isPending: false })
    mocks.overview.mockReturnValue({
      data: { providers: [], hasSearchableDocuments: false },
      isPending: false,
    })
    await render()
    expect(document.body.textContent).toContain('Ask an organization admin to get started')
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
    expect(buttons('Connect account')).toHaveLength(0)
    expect(document.body.textContent).not.toContain('hasn’t added any sources')
    await act(async () => buttons('Load more')[0].click())
    expect(fetchNextPage).toHaveBeenCalledOnce()
  })

  it('retains loaded rows on a next-page failure and retries only that page', async () => {
    const fetchNextPage = vi.fn()
    mocks.sources.mockReturnValue({
      data: [centralSource],
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
