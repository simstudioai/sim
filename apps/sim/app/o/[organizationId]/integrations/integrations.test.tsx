/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchSourceSummary } from '@/lib/api/contracts/knowledge/connectors'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  sources: vi.fn(),
  integrations: vi.fn(),
  filters: vi.fn(),
  setSource: vi.fn(),
  connect: vi.fn(),
}))

vi.mock('@/hooks/queries/search-integrations', () => ({
  useSearchIntegrations: mocks.integrations,
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({
    integrationAvailability: new Map(),
    oauthServiceAvailability: new Map([['google-email', true]]),
    isIntegrationAvailabilityReady: true,
  }),
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
    mocks.sources.mockReturnValue({ data: [memberSource, centralSource], isPending: false })
    mocks.filters.mockReturnValue({ tab: null, search: '', setSearch: vi.fn() })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
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
    expect(mocks.sources).toHaveBeenCalledWith(scope)
    expect(buttons('Add source')).toHaveLength(0)
    expect(buttons('Manage')).toHaveLength(0)
    expect(buttons('Connect account')).toHaveLength(1)
    expect(document.body.textContent).toContain('4 searchable documents')
    await act(async () => buttons('Connect account')[0].click())
    expect(mocks.connect).toHaveBeenCalledExactlyOnceWith('search-index', 'member-source')
  })

  it('offers an approved integration before any source is configured', async () => {
    mocks.sources.mockReturnValue({ data: [], isPending: false })
    mocks.integrations.mockReturnValue({
      data: [{ connectorType: 'gmail', approved: true }],
      isPending: false,
    })
    await render()
    expect(document.body.textContent).toContain('Approved')
    expect(buttons('Connect account')).toHaveLength(1)
    await act(async () => buttons('Connect account')[0].click())
    expect(mocks.connect).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ type: 'gmail' }),
      undefined
    )
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
  it('asks an admin to configure Slack before members can connect an approved source', async () => {
    mocks.sources.mockReturnValue({ data: [], isPending: false })
    mocks.integrations.mockReturnValue({
      data: [{ connectorType: 'slack', approved: true }],
      isPending: false,
    })
    await render()
    expect(buttons('Connect account')).toHaveLength(0)
    expect(document.body.textContent).toContain('An admin needs to finish source setup')
  })
  it('shows an organization admin exactly what a member sees, with no setup or management', async () => {
    mocks.context.mockReturnValue({
      organization: { id: scope.organizationId },
      viewer: { isAdmin: true },
      searchAccess: { memberScoped: true, sourceMirrored: true },
    })
    await render()
    expect(buttons('Add source')).toHaveLength(0)
    expect(buttons('Manage')).toHaveLength(0)
    expect(document.querySelector('[aria-label$="source actions"]')).toBeNull()
    expect(buttons('Connect account')).toHaveLength(1)
  })

  it('lists only the sources the viewer connected under Mine', async () => {
    mocks.filters.mockReturnValue({ tab: 'mine', search: '', setSearch: vi.fn() })
    await render()
    expect(document.body.textContent).toContain('You haven’t connected any sources yet.')
    mocks.sources.mockReturnValue({
      data: [{ ...memberSource, viewerMembership: 'connected' }, centralSource],
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
    await render()
    expect(document.body.textContent).toContain('Ask an organization admin to get started')
    expect(buttons('Add source')).toHaveLength(0)
  })
})
