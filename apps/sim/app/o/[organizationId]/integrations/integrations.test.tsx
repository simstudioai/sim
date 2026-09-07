/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchSourceSummary } from '@/lib/api/contracts/knowledge/connectors'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  sources: vi.fn(),
  filters: vi.fn(),
  setSource: vi.fn(),
  connect: vi.fn(),
  setup: vi.fn(),
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
vi.mock('@/app/o/[organizationId]/integrations/slack-account-setup', () => ({
  OrganizationSlackAccountSetup: () => null,
}))
vi.mock('@/app/workspace/[workspaceId]/search/components/search-source-setup', () => ({
  SearchSourceSetup: mocks.setup,
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
    mocks.sources.mockReturnValue({ data: [memberSource, centralSource], isPending: false })
    mocks.filters.mockReturnValue({ search: '', setSearch: vi.fn() })
    mocks.setup.mockReturnValue(null)
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
    expect(mocks.setup).toHaveBeenCalledWith(
      expect.objectContaining({ scope, canAdmin: false }),
      undefined
    )
  })

  it('gives admins source setup and management while retaining their own enrollment action', async () => {
    mocks.context.mockReturnValue({
      organization: { id: scope.organizationId },
      viewer: { isAdmin: true },
      searchAccess: { memberScoped: true, sourceMirrored: true },
    })
    await render()
    expect(buttons('Add source')).toHaveLength(1)
    expect(buttons('Manage')).toHaveLength(1)
    expect(buttons('Connect account')).toHaveLength(1)
    await act(async () => buttons('Add source')[0].click())
    expect(mocks.setSource).toHaveBeenCalledWith('')
    await act(async () => buttons('Manage')[0].click())
    expect(mocks.setSource).toHaveBeenCalledWith('central-source', { history: 'push' })
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
