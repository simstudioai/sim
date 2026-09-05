/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  mockConnect,
  mockConnectSource,
  mockFeatures,
  mockExtraSources,
  mockSearchTerm,
  mockPrepareSource,
  mockNavigate,
  mockSlackAvailable,
  mockAccounts,
} = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockConnectSource: vi.fn(),
  mockFeatures: vi.fn(),
  mockExtraSources: vi.fn(),
  mockSearchTerm: vi.fn(),
  mockPrepareSource: vi.fn(),
  mockNavigate: vi.fn(),
  mockSlackAvailable: vi.fn(),
  mockAccounts: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
  usePathname: () => '/workspace/workspace-1/search',
  useRouter: () => ({ push: mockNavigate }),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useOptionalWorkspaceHostContext: () => ({ features: mockFeatures() }),
  useWorkspaceHostContext: () => ({ features: mockFeatures() }),
}))
vi.mock('nuqs', () => ({
  useQueryState: (key: string) => [key === 'search' ? (mockSearchTerm() ?? '') : false, vi.fn()],
}))
vi.mock('@/hooks/use-debounced-search-setter', () => ({
  useDebouncedSearchSetter: (write: (value: string) => void) => write,
}))
vi.mock('@/hooks/queries/credential-groups', () => ({
  useWorkspaceAccounts: () => ({
    data: mockAccounts() ?? { credentialGroup: null },
    isLoading: false,
  }),
}))
vi.mock('@/hooks/queries/workspace', () => ({
  useWorkspacePermissionsQuery: () => ({ data: { viewer: { isAdmin: true } } }),
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({
    integrationAvailability: new Map([
      ['slack', { oauthAvailable: mockSlackAvailable() ?? false }],
      ['jira', { state: 'available', oauthAvailable: true }],
    ]),
  }),
}))
vi.mock('@/app/workspace/[workspaceId]/integrations/hooks/use-scroll-restoration', () => ({
  useScrollRestoration: () => undefined,
}))
vi.mock('@/app/workspace/[workspaceId]/components', () => ({
  IntegrationTabsHeader: () => null,
}))
vi.mock('@/blocks', () => ({ getBlock: () => undefined }))
vi.mock('@/app/workspace/[workspaceId]/search/components/managed-search-sources', () => ({
  ManagedSearchSources: () => null,
}))
vi.mock('@/lib/integrations', () => ({
  blockTypeToIconMap: {},
  resolveCredentialDisplay: () => ({ icon: () => null, blockType: 'confluence', subtitle: 'Sub' }),
}))

vi.mock('@/lib/sim-search/connectors', () => {
  const icon = () => null
  const connector = (type: string, name: string, description: string, personal: boolean) => ({
    type,
    meta: {
      id: type,
      name,
      description,
      icon,
      auth: { mode: 'oauth', provider: type },
      permissionScopedListing: personal ? { capFieldIds: [] } : undefined,
      configFields: personal ? [] : [{ id: 'domain', required: true }],
    },
    providerId: type,
    providerIds: [type],
    requiredScopes: [],
    serviceName: name,
    serviceIcon: icon,
    blockType: type,
    setupFields: [],
  })
  const isSearchConnectorAvailable = (
    candidate: { blockType: string },
    availability: ReadonlyMap<string, { oauthAvailable: boolean }>
  ) => availability.get(candidate.blockType)?.oauthAvailable ?? true
  return {
    SIM_SEARCH_KNOWLEDGE_BASE_NAME: 'Sim Search',
    MANAGED_SEARCH_CONNECTORS: [],
    canConnectPersonally: (meta: { permissionScopedListing?: unknown }) =>
      Boolean(meta.permissionScopedListing),
    connectorDisplayName: (connectorType: string) => connectorType,
    isSearchConnectorAvailable,
    searchConnectorUnavailableReason: (
      candidate: { blockType: string; meta: { name: string } },
      availability: ReadonlyMap<string, { oauthAvailable: boolean }>,
      context: { memberAccessAvailable: boolean; hasConnection: boolean; canCreate: boolean }
    ) =>
      !isSearchConnectorAvailable(candidate, availability)
        ? `${candidate.meta.name} is unavailable in this deployment`
        : !context.memberAccessAvailable
          ? 'Per-member access is not available in this workspace'
          : !context.hasConnection && !context.canCreate
            ? `Ask a workspace admin to connect ${candidate.meta.name} first`
            : null,
    SEARCH_CONNECTORS: [
      connector('google_drive', 'Google Drive', 'Sync Drive files', true),
      connector('confluence', 'Confluence', 'Sync Confluence pages', false),
      connector('slack', 'Slack', 'Sync Slack messages', true),
    ],
  }
})

vi.mock('@/hooks/queries/kb/connectors', () => ({
  usePrepareSearchSource: () => ({ mutate: mockPrepareSource, isPending: false, error: null }),
  memberConnectorKeys: { list: (workspaceId?: string) => ['member-connectors', workspaceId] },
  useWorkspaceMemberConnectors: () => ({
    isPending: false,
    data: [
      ...(mockExtraSources() ?? []),
      {
        knowledgeBaseId: 'kb-search',
        knowledgeBaseName: 'Sim Search',
        knowledgeBaseIsSearchIndex: true,
        connectorId: 'conn-drive',
        connectorType: 'google_drive',
        memberSyncStatus: 'idle',
        viewerMembership: 'connected',
        viewerDocumentCount: 12,
      },
      {
        knowledgeBaseId: 'kb-sales',
        knowledgeBaseName: 'Sales',
        connectorId: 'conn-sales-drive',
        connectorType: 'google_drive',
        memberSyncStatus: 'idle',
        viewerMembership: 'invited',
        viewerDocumentCount: 0,
      },
    ],
  }),
}))
vi.mock('@/hooks/use-member-enrollment', () => ({
  CONNECTABLE_MEMBERSHIPS: new Set(['needs_reauth', 'invited', 'not_enrolled']),
  describeMembership: ({ membership }: { membership: string }) =>
    membership === 'connected' ? null : 'Connect your account to search its documents.',
  enrollmentActionLabel: () => 'Connect',
  useMemberEnrollment: () => ({
    connect: mockConnect,
    connectSource: mockConnectSource,
    connectSearchSource: (
      workspaceId: string,
      connector: { type: string },
      connection: { knowledgeBaseId: string; connectorId: string } | undefined
    ) =>
      connection
        ? mockConnect(connection.knowledgeBaseId, connection.connectorId)
        : mockConnectSource(workspaceId, connector.type),
    setupConnector: null,
    closeSetup: () => {},
    isAwaiting: () => false,
    isAwaitingSource: () => false,
    isPending: false,
    error: null,
  }),
}))
vi.mock('@/connectors/registry', () => ({
  CONNECTOR_META_REGISTRY: { google_drive: { name: 'Google Drive', icon: () => null } },
}))

import { Search } from '@/app/workspace/[workspaceId]/search/search'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(features: { knowledgeMemberAccess?: boolean } = { knowledgeMemberAccess: true }) {
  mockFeatures.mockReturnValue({ credentialGroups: true, ...features })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<Search />))
}

function sectionLabels(): string[] {
  return Array.from(container?.querySelectorAll('section > div > span') ?? []).map(
    (node) => node.textContent ?? ''
  )
}

function buttons(): HTMLButtonElement[] {
  return Array.from(container?.querySelectorAll('button') ?? [])
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  mockConnect.mockReset()
  mockConnectSource.mockReset()
  mockExtraSources.mockReset()
  mockSearchTerm.mockReset()
  mockPrepareSource.mockReset()
  mockNavigate.mockReset()
  mockSlackAvailable.mockReset()
  mockAccounts.mockReset()
})

describe('Search', () => {
  it('links Slack member sign-in directly to Connected accounts', () => {
    mockSlackAvailable.mockReturnValue(true)
    mount()
    const link = Array.from(container?.querySelectorAll('a') ?? []).find((node) =>
      node.textContent?.includes('Set up Slack')
    )
    expect(link?.getAttribute('href')).toBe(
      '/workspace/workspace-1/settings/credential-groups?search-setup=search&credential-group-provider=slack'
    )
    expect(container?.textContent).not.toContain('Set up Slack app')
    expect(container?.textContent).not.toContain(
      'Documents become searchable as indexing completes'
    )
    expect(mockPrepareSource).not.toHaveBeenCalled()
  })

  it('offers personal Connect after Slack is configured and keeps MCP above the sources', () => {
    mockSlackAvailable.mockReturnValue(true)
    mockAccounts.mockReturnValue({
      credentialGroup: {
        status: 'active',
        options: [{ provider: 'slack', status: 'active', configurationStatus: 'ready' }],
      },
    })
    mount()
    expect(container?.textContent).not.toContain('Set up Slack')
    expect(container?.textContent?.indexOf('Use Search in other apps')).toBeLessThan(
      container?.textContent?.indexOf('Your accounts') ?? -1
    )
    const connect = buttons()
      .filter((button) => button.textContent === 'Connect')
      .at(0)
    act(() => connect?.click())
    expect(mockConnectSource).toHaveBeenCalledWith('workspace-1', 'slack')
  })

  it('filters configured sources by their displayed source address', () => {
    mockExtraSources.mockReturnValue([
      {
        knowledgeBaseId: 'kb-search',
        knowledgeBaseName: 'Sim Search',
        knowledgeBaseIsSearchIndex: true,
        connectorId: 'conn-finance',
        connectorType: 'google_drive',
        sourceDescription: 'Finance folder',
        memberSyncStatus: 'idle',
        viewerMembership: 'not_enrolled',
        viewerDocumentCount: 0,
      },
    ])
    mockSearchTerm.mockReturnValue('finance')
    mount()
    expect(container?.textContent).toContain('Finance folder')
    expect(container?.textContent).not.toContain('Connected · 12 documents')
    expect(container?.textContent).not.toContain('Sales')
  })

  it('shows every configured source and connects the selected source by its exact ID', () => {
    mockExtraSources.mockReturnValue([
      {
        knowledgeBaseId: 'kb-search',
        knowledgeBaseName: 'Sim Search',
        knowledgeBaseIsSearchIndex: true,
        connectorId: 'conn-finance',
        connectorType: 'google_drive',
        sourceDescription: 'Finance folder',
        memberSyncStatus: 'idle',
        viewerMembership: 'not_enrolled',
        viewerDocumentCount: 0,
      },
    ])
    mount()
    const section = Array.from(container?.querySelectorAll('section') ?? []).find((node) =>
      node.textContent?.includes('Your accounts')
    )
    expect(section?.textContent).toContain('Finance folder')
    expect(section?.textContent).toContain('Connected · 12 documents')
    const connect = Array.from(section?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent === 'Connect'
    )
    act(() => connect?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })))
    expect(mockConnect).toHaveBeenCalledWith('kb-search', 'conn-finance')
  })

  it('shows each source with the viewer’s own connection state', () => {
    mount()

    expect(sectionLabels()).toEqual(['Your accounts', 'Shared with you'])
    const text = container?.textContent ?? ''
    expect(text).toContain('Connected · 12 documents')
    expect(text).toContain('Set up by a workspace admin from a knowledge base.')
    expect(text).not.toContain('Slack')
    expect(text).toContain('Sales')
  })

  it('hides unavailable providers that have no configured source', () => {
    mockSearchTerm.mockReturnValue('slack')
    mount()
    expect(container?.textContent).not.toContain('Slack')
    expect(sectionLabels()).not.toContain('Your accounts')
    expect(buttons().some((button) => button.textContent === 'Connect')).toBe(false)
  })

  it('keeps configured unavailable sources visible with their source identity', () => {
    mockExtraSources.mockReturnValue([
      {
        knowledgeBaseId: 'kb-search',
        knowledgeBaseName: 'Sim Search',
        knowledgeBaseIsSearchIndex: true,
        connectorId: 'conn-slack',
        connectorType: 'slack',
        sourceDescription: 'Support workspace',
        memberSyncStatus: 'idle',
        viewerMembership: 'connected',
        viewerDocumentCount: 5,
      },
    ])
    mockSearchTerm.mockReturnValue('support')
    mount()
    expect(container?.textContent).toContain('Slack')
    expect(container?.textContent).toContain(
      'Support workspace · Slack is unavailable in this deployment'
    )
    expect(buttons().some((button) => button.textContent === 'Connect')).toBe(false)
  })

  it('keeps a previously configured unsupported source reachable without new enrollment', () => {
    mockExtraSources.mockReturnValue([
      {
        knowledgeBaseId: 'kb-search',
        knowledgeBaseName: 'Sim Search',
        knowledgeBaseIsSearchIndex: true,
        connectorId: 'conn-legacy',
        connectorType: 'airtable',
        sourceDescription: 'Legacy finance source',
        memberSyncStatus: 'idle',
        viewerMembership: 'not_enrolled',
        viewerDocumentCount: 0,
      },
    ])
    mockSearchTerm.mockReturnValue('legacy finance')
    mount()
    expect(container?.textContent).toContain('Existing sources')
    expect(container?.textContent).toContain('Legacy finance source')
    expect(
      container?.querySelector('a[href="/workspace/workspace-1/knowledge/kb-search"]')?.textContent
    ).toBe('Manage')
    expect(buttons().some((button) => button.textContent === 'Connect')).toBe(false)
    expect(container?.textContent).not.toContain('No connectors found')
  })

  it('connects a source nobody has connected yet through its per-member connector', () => {
    mount()

    const connect = buttons().find((button) => button.textContent === 'Connect')
    expect(connect).toBeDefined()
    act(() => {
      connect?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    })

    expect(mockConnect).toHaveBeenCalledWith('kb-sales', 'conn-sales-drive')
    expect(mockConnectSource).not.toHaveBeenCalled()
  })

  it('offers no connection while per-member access is unavailable in the workspace', () => {
    mount({ knowledgeMemberAccess: false })

    expect(sectionLabels()).toEqual(['Your accounts'])
    const text = container?.textContent ?? ''
    expect(text).toContain('Per-member access is not available in this workspace')
    expect(text).not.toContain('Connected · 12 documents')
    expect(buttons().find((button) => button.textContent === 'Connect')).toBeUndefined()
  })
})
