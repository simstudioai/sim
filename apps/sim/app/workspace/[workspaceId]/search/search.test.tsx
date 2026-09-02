/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockConnect, mockConnectSource } = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockConnectSource: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))
vi.mock('nuqs', () => ({
  useQueryState: () => ['', vi.fn()],
}))
vi.mock('@/hooks/use-debounced-search-setter', () => ({
  useDebouncedSearchSetter: (write: (value: string) => void) => write,
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
  })
  return {
    SIM_SEARCH_KNOWLEDGE_BASE_NAME: 'Sim Search',
    canConnectPersonally: (meta: { permissionScopedListing?: unknown }) =>
      Boolean(meta.permissionScopedListing),
    isSearchConnectorAvailable: (
      candidate: { blockType: string },
      availability: ReadonlyMap<string, { oauthAvailable: boolean }>
    ) => availability.get(candidate.blockType)?.oauthAvailable ?? true,
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
      isAwaiting: () => false,
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

function mount() {
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
    expect(text).toContain('Unavailable in this deployment. Contact your administrator.')
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
})
