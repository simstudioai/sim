/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockConnect, mockConnectSource, mockFeatures } = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockConnectSource: vi.fn(),
  mockFeatures: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useOptionalWorkspaceHostContext: () => ({ features: mockFeatures() }),
}))
vi.mock('nuqs', () => ({
  useQueryState: () => ['', vi.fn()],
}))
vi.mock('@/hooks/use-debounced-search-setter', () => ({
  useDebouncedSearchSetter: (write: (value: string) => void) => write,
}))
vi.mock('@/hooks/queries/workspace', () => ({
  useWorkspacePermissionsQuery: () => ({ data: { viewer: { isAdmin: true } } }),
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({
    integrationAvailability: new Map([
      ['slack', { state: 'limited', oauthAvailable: false }],
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
  memberConnectorKeys: { list: (workspaceId?: string) => ['member-connectors', workspaceId] },
  useWorkspaceMemberConnectors: () => ({
    isPending: false,
    data: [
      {
        knowledgeBaseId: 'kb-search',
        knowledgeBaseName: 'Sim Search',
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
vi.mock('@/hooks/use-member-enrollment', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/use-member-enrollment')>(
    '@/hooks/use-member-enrollment'
  )
  return {
    CONNECTABLE_MEMBERSHIPS: actual.CONNECTABLE_MEMBERSHIPS,
    describeMembership: actual.describeMembership,
    enrollmentActionLabel: actual.enrollmentActionLabel,
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
  }
})
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
})

describe('Search', () => {
  it('shows each source with the viewer’s own connection state', () => {
    mount()

    expect(sectionLabels()).toEqual(['Sim Search Connectors', 'Shared with you'])
    const text = container?.textContent ?? ''
    expect(text).toContain('Connected · 12 documents')
    expect(text).toContain('Set up by a workspace admin from a knowledge base.')
    expect(text).toContain('Slack is unavailable in this deployment')
    expect(text).toContain('Sales')
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

    expect(sectionLabels()).toEqual(['Sim Search Connectors'])
    const text = container?.textContent ?? ''
    expect(text).toContain('Per-member access is not available in this workspace')
    expect(text).not.toContain('Connected · 12 documents')
    expect(buttons().find((button) => button.textContent === 'Connect')).toBeUndefined()
  })
})
