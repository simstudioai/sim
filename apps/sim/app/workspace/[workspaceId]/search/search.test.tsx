/** @vitest-environment jsdom */
import { act } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SearchSourceSummary,
  WorkspaceMemberConnector,
} from '@/lib/api/contracts/knowledge/connectors'

const mocks = vi.hoisted(() => ({
  canAdmin: false,
  features: { knowledgeMemberAccess: true, knowledgeSourceMirroredAccess: true },
  sources: [] as SearchSourceSummary[],
  shared: [] as WorkspaceMemberConnector[],
  sourcePending: false,
  sourceError: null as Error | null,
  sharedError: null as Error | null,
  sourceRefetch: vi.fn(),
  sharedRefetch: vi.fn(),
  sourceQuery: vi.fn(),
  sharedQuery: vi.fn(),
  connect: vi.fn(),
  setup: vi.fn(),
  sharedRows: vi.fn(),
  urlUpdate: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useWorkspaceHostContext: () => ({ features: mocks.features }),
}))
vi.mock('@/hooks/use-member-access', () => ({
  useMemberAccessAvailable: () => mocks.features.knowledgeMemberAccess,
}))
vi.mock('@/hooks/queries/workspace', () => ({
  useWorkspacePermissionsQuery: () => ({ data: { viewer: { isAdmin: mocks.canAdmin } } }),
}))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  searchSourceKeys: { list: (id: string) => ['search-sources', id] },
  useSearchSources: (id: string) => {
    mocks.sourceQuery(id)
    return {
      data: mocks.sources,
      isPending: mocks.sourcePending,
      isError: Boolean(mocks.sourceError),
      error: mocks.sourceError,
      isFetching: false,
      refetch: mocks.sourceRefetch,
    }
  },
  useWorkspaceMemberConnectors: (id: string, options: { enabled: boolean }) => {
    mocks.sharedQuery(id, options)
    return {
      data: mocks.shared,
      isError: Boolean(mocks.sharedError),
      error: mocks.sharedError,
      isFetching: false,
      refetch: mocks.sharedRefetch,
    }
  },
}))
vi.mock('@/hooks/use-member-enrollment', () => ({
  CONNECTABLE_MEMBERSHIPS: new Set(['needs_reauth', 'invited', 'not_enrolled']),
  useMemberEnrollment: () => ({
    connect: mocks.connect,
    isAwaiting: () => false,
    isPending: false,
    error: null,
  }),
}))
vi.mock('@/hooks/use-debounced-search-setter', () => ({
  useDebouncedSearchSetter: (write: (value: string) => void) => write,
}))
vi.mock('@/app/workspace/[workspaceId]/integrations/hooks/use-scroll-restoration', () => ({
  useScrollRestoration: () => undefined,
}))
vi.mock('@/app/workspace/[workspaceId]/components', () => ({ IntegrationTabsHeader: () => null }))
vi.mock('@/app/workspace/[workspaceId]/integrations/components/integrations-showcase', () => ({
  IntegrationTile: () => null,
}))
vi.mock('@/app/workspace/[workspaceId]/search/components/search-source-setup', () => ({
  SearchSourceSetup: (props: { canAdmin: boolean }) => {
    mocks.setup(props)
    return <div data-testid='source-setup' />
  },
}))
vi.mock(
  '@/app/workspace/[workspaceId]/search/components/member-connectors-section/member-connectors-section',
  () => ({
    MemberConnectorsSection: (props: { connectors: WorkspaceMemberConnector[] }) => {
      mocks.sharedRows(props.connectors)
      return props.connectors.length ? <div>Shared with you</div> : null
    },
  })
)

import { Search } from '@/app/workspace/[workspaceId]/search/search'

function source(overrides: Partial<SearchSourceSummary> = {}): SearchSourceSummary {
  return {
    knowledgeBaseId: 'kb-search',
    connectorId: 'drive-1',
    connectorType: 'google_drive',
    sourceDescription: 'Company files',
    accessMode: 'admin',
    availability: 'available',
    enabled: true,
    isSyncing: false,
    lastSyncAt: '2026-09-05T12:00:00Z',
    hasSyncError: false,
    viewerDocumentCount: 12,
    viewerEmailVerified: true,
    connectionRequired: false,
    viewerMembership: null,
    ...overrides,
  } as SearchSourceSummary
}

function button(label: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (node) => node.textContent?.trim() === label || node.getAttribute('aria-label') === label
  )
}

let root: Root
let container: HTMLDivElement
async function render(searchParams = '') {
  await act(async () =>
    root.render(
      <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={mocks.urlUpdate}>
        <Search />
      </NuqsTestingAdapter>
    )
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.canAdmin = false
  mocks.features = { knowledgeMemberAccess: true, knowledgeSourceMirroredAccess: true }
  mocks.sources = [source(), source({ connectorId: 'gitlab-1', connectorType: 'gitlab' })]
  mocks.shared = []
  mocks.sourcePending = false
  mocks.sourceError = null
  mocks.sharedError = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('unified Search sources', () => {
  it('shows configured central Drive and GitLab sources to readers without setup controls', async () => {
    await render()
    expect(document.body.textContent).toContain('Google Drive')
    expect(document.body.textContent).toContain('GitLab')
    expect(document.body.textContent).not.toContain('Slack')
    expect(document.body.textContent).not.toContain('Confluence')
    expect(button('Add source')).toBeUndefined()
    expect(button('Manage')).toBeUndefined()
    expect(button('Connect account')).toBeUndefined()
    expect(mocks.sourceQuery).toHaveBeenCalledWith('workspace-1')
    expect(mocks.setup).toHaveBeenLastCalledWith(expect.objectContaining({ canAdmin: false }))
  })

  it('connects each configured Confluence site using its exact connector ID', async () => {
    mocks.sources = ['engineering', 'sales'].map((site) =>
      source({
        connectorId: `confluence-${site}`,
        connectorType: 'confluence',
        sourceDescription: `${site}.atlassian.net`,
        accessMode: 'members',
        connectionRequired: true,
        viewerMembership: 'invited',
      })
    )
    await render()
    const buttons = Array.from(document.querySelectorAll('button')).filter(
      (node) => node.textContent === 'Connect account'
    )
    expect(buttons).toHaveLength(2)
    expect(document.body.textContent).toContain('engineering.atlassian.net')
    expect(document.body.textContent).toContain('sales.atlassian.net')
    await act(async () => buttons[1]!.click())
    expect(mocks.connect).toHaveBeenCalledExactlyOnceWith('kb-search', 'confluence-sales')
  })

  it('offers only the member’s required account actions across mixed source methods', async () => {
    mocks.sources.push(
      source({
        connectorId: 'confluence-central',
        connectorType: 'confluence',
        connectionRequired: true,
        viewerMembership: 'not_enrolled',
      }),
      source({
        connectorId: 'drive-members',
        accessMode: 'members',
        connectionRequired: true,
        viewerMembership: 'connected',
      }),
      source({
        connectorId: 'slack-members',
        connectorType: 'slack',
        accessMode: 'members',
        connectionRequired: true,
        viewerMembership: 'needs_reauth',
      })
    )
    await render()
    const actions = Array.from(document.querySelectorAll('button')).map((node) =>
      node.textContent?.trim()
    )
    expect(actions).toEqual(['Connect account', 'Reconnect'])
    await act(async () => button('Connect account')!.click())
    await act(async () => button('Reconnect')!.click())
    expect(mocks.connect.mock.calls).toEqual([
      ['kb-search', 'confluence-central'],
      ['kb-search', 'slack-members'],
    ])
    expect(mocks.urlUpdate).not.toHaveBeenCalled()
  })

  it('keeps central email-based sources usable when managed identities become unavailable', async () => {
    mocks.features.knowledgeMemberAccess = false
    mocks.sources.push(
      source({
        connectorId: 'confluence-central',
        connectorType: 'confluence',
        connectionRequired: true,
        viewerMembership: 'invited',
      }),
      source({
        connectorId: 'slack-members',
        connectorType: 'slack',
        accessMode: 'members',
        connectionRequired: true,
        viewerMembership: 'needs_reauth',
      })
    )
    await render()
    expect(document.body.textContent?.match(/12 searchable documents/g)).toHaveLength(2)
    expect(document.body.textContent?.match(/Not available in this workspace/g)).toHaveLength(2)
    expect(button('Connect account')).toBeUndefined()
    expect(button('Reconnect')).toBeUndefined()
    expect(mocks.sharedQuery).toHaveBeenLastCalledWith('workspace-1', { enabled: false })
  })

  it('allows admins to add member sources when mirrored access is off', async () => {
    mocks.canAdmin = true
    mocks.features.knowledgeSourceMirroredAccess = false
    await render('?search=slack')
    expect(button('Add source')).toBeDefined()
    await act(async () => button('Add source')!.click())
    await vi.waitFor(() =>
      expect(mocks.urlUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ queryString: '?addConnector=' })
      )
    )
    expect(mocks.setup).toHaveBeenLastCalledWith(
      expect.objectContaining({ memberAccessAvailable: true, mirroredAccessAvailable: false })
    )
  })

  it('keeps general-KB enrollments under Shared with you and excludes index duplicates', async () => {
    const shared: WorkspaceMemberConnector = {
      knowledgeBaseId: 'kb-sales',
      knowledgeBaseName: 'Sales',
      knowledgeBaseIsSearchIndex: false,
      connectorId: 'sales-drive',
      connectorType: 'google_drive',
      sourceDescription: 'Sales folder',
      memberSyncStatus: 'idle',
      viewerMembership: 'invited',
      viewerDocumentCount: 0,
    }
    mocks.shared = [shared, { ...shared, connectorId: 'drive-1', knowledgeBaseIsSearchIndex: true }]
    await render()
    expect(mocks.sharedRows).toHaveBeenLastCalledWith([shared])
    expect(document.body.textContent).toContain('Shared with you')
  })

  it('blocks cached member and identity actions after features turn off', async () => {
    mocks.canAdmin = true
    mocks.features = { knowledgeMemberAccess: false, knowledgeSourceMirroredAccess: false }
    mocks.sources = [
      source({ accessMode: 'members', connectionRequired: true, viewerMembership: 'invited' }),
      source({
        connectorId: 'confluence-1',
        connectorType: 'confluence',
        connectionRequired: true,
        viewerMembership: 'needs_reauth',
      }),
    ]
    await render()
    expect(document.body.textContent).toContain('Not available in this workspace')
    expect(button('Connect account')).toBeUndefined()
    expect(button('Reconnect')).toBeUndefined()
    expect(button('Add source')).toBeUndefined()
    expect(mocks.sharedQuery).toHaveBeenLastCalledWith('workspace-1', { enabled: false })
    expect(mocks.sharedRows).not.toHaveBeenCalled()
  })

  it.each([false, true])('provides a useful empty state for canAdmin=%s', async (canAdmin) => {
    mocks.canAdmin = canAdmin
    mocks.sources = []
    await render()
    expect(document.body.textContent).toContain(
      canAdmin ? 'Add a source to start indexing' : 'Ask a workspace admin to get started'
    )
  })

  it('shows loading and then a retryable source error without stale rows', async () => {
    mocks.sourcePending = true
    await render()
    expect(document.body.textContent).toContain('Loading sources…')
    expect(document.body.textContent).not.toContain('Google Drive')
    mocks.sourcePending = false
    mocks.sourceError = new Error('Could not fetch sources')
    await render()
    expect(document.body.textContent).toContain('Could not fetch sources')
    await act(async () => button('Try again')!.click())
    expect(mocks.sourceRefetch).toHaveBeenCalledOnce()
    expect(document.body.textContent).not.toContain('Google Drive')
  })

  it('retries shared-source failures without hiding the configured sources', async () => {
    mocks.sharedError = new Error('Shared sources failed')
    await render()
    expect(document.body.textContent).toContain('Google Drive')
    expect(document.body.textContent).toContain('Shared sources failed')
    await act(async () => button('Try again')!.click())
    expect(mocks.sharedRefetch).toHaveBeenCalledOnce()
  })

  it('filters by provider and source address while retaining the setup owner for a return URL', async () => {
    mocks.canAdmin = true
    await render('?search=missing&addConnector=gitlab&credentialDraftId=draft-1')
    expect(document.body.textContent).toContain('No matching sources.')
    expect(document.body.textContent).not.toContain('Google Drive')
    expect(document.querySelector('[data-testid="source-setup"]')).not.toBeNull()
    expect(mocks.urlUpdate).not.toHaveBeenCalled()
  })

  it('pushes source management without replacing the filtered list URL used by Back', async () => {
    mocks.canAdmin = true
    await render('?search=gitlab')
    expect(document.body.textContent).toContain('GitLab')
    expect(document.body.textContent).not.toContain('Google Drive')
    await act(async () => button('Manage')!.click())
    await vi.waitFor(() =>
      expect(mocks.urlUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          queryString: '?search=gitlab&manage-source=gitlab-1',
          options: expect.objectContaining({ history: 'push' }),
        })
      )
    )
    await render('?search=gitlab&manage-source=gitlab-1')
    await render('?search=gitlab')
    expect(document.querySelector('input')?.value).toBe('gitlab')
    expect(document.body.textContent).toContain('GitLab')
    expect(document.body.textContent).not.toContain('Google Drive')
  })

  it('opens admin source management by connector ID', async () => {
    mocks.canAdmin = true
    await render()
    await act(async () => button('Manage')!.click())
    await vi.waitFor(() =>
      expect(mocks.urlUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          queryString: '?manage-source=drive-1',
          options: expect.objectContaining({ history: 'push' }),
        })
      )
    )
  })
})
