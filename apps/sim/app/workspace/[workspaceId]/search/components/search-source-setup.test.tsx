/**
 * @vitest-environment jsdom
 */
import { act, cloneElement, type ReactNode } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAdmin: true,
  availabilityReady: true,
  availabilityLoading: false,
  availabilityError: null as Error | null,
  refetchAvailability: vi.fn(),
  unavailableProviders: [] as string[],
  integrationAvailability: new Map<
    string,
    { oauthAvailable: boolean; state: 'ready' | 'limited' | 'unavailable' | 'misconfigured' }
  >(),
  userId: 'user-1',
  urlUpdate: vi.fn(),
  oauthReturn: vi.fn(),
  sourceStatus: vi.fn(),
  features: { knowledgeMemberAccess: true, knowledgeSourceMirroredAccess: true },
  create: vi.fn(),
  update: vi.fn(),
  applyAccess: vi.fn(),
  prepare: vi.fn(),
  createPending: false,
  updatePending: false,
  accessPending: false,
  basesPending: false,
  basesError: null as Error | null,
  connectorsError: null as Error | null,
  connectorsPending: false,
  refetchBases: vi.fn(),
  refetchConnectors: vi.fn(),
  preparePending: false,
  prepareError: null as Error | null,
  prepareData: undefined as { knowledgeBaseId: string } | undefined,
  bases: [{ id: 'kb-search', name: 'Sim Search', isSearchIndex: true }] as {
    id: string
    name: string
    isSearchIndex?: boolean
  }[],
  connectors: [] as { id: string; connectorType: string; accessMode: string; status: string }[],
  credentials: [{ id: 'cred-source', name: 'Indexing account', provider: 'slack' }] as {
    id: string
    name: string
    provider: string
    type?: 'oauth' | 'service_account'
  }[],
  credentialGroup: null as {
    id: string
    name: string
    status: string
    options: {
      id: string
      label: string
      status: string
      provider: string
      configurationStatus: string
    }[]
  } | null,
  basesQuery: vi.fn(),
  connectorsQuery: vi.fn(),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: mocks.userId } } }),
}))
vi.mock('@/hooks/use-oauth-return', () => ({ useOAuthReturnForKBConnectors: mocks.oauthReturn }))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({
    integrationAvailability: new Map([
      ['slack', { oauthAvailable: true, state: 'ready' }],
      ['slack_v2', { oauthAvailable: true, state: 'ready' }],
      ...mocks.integrationAvailability,
    ]),
    oauthServiceAvailability: new Map(
      [
        'confluence',
        'google-drive',
        'google_drive',
        'google-email',
        'google-calendar',
        'jira',
        'github-repositories',
      ].map((providerId) => [providerId, !mocks.unavailableProviders.includes(providerId)])
    ),
    isIntegrationAvailabilityReady: mocks.availabilityReady,
    isIntegrationAvailabilityLoading: mocks.availabilityLoading,
    integrationAvailabilityError: mocks.availabilityError,
    refetchIntegrationAvailability: mocks.refetchAvailability,
  }),
}))
vi.mock('@/app/workspace/[workspaceId]/search/components/search-source-status', () => ({
  SearchSourceStatus: (props: { knowledgeBaseId: string; connectorType: string }) => {
    mocks.sourceStatus(props)
    return <div role='dialog'>Source sync status</div>
  },
}))
vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
  usePathname: () => '/workspace/workspace-1/search',
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useWorkspaceHostContext: () => ({ ownerBilling: {}, features: mocks.features }),
  useOptionalWorkspaceHostContext: () => ({ ownerBilling: {}, features: mocks.features }),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({ canAdmin: mocks.canAdmin }),
}))
vi.mock('@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-scope', () => ({
  useConnectorScope: (
    scope?:
      | { kind: 'workspace'; workspaceId: string }
      | { kind: 'organization'; organizationId: string }
  ) => ({
    scope: scope ?? { kind: 'workspace', workspaceId: 'workspace-1' },
    canAdmin: mocks.canAdmin,
    memberAccessAvailable: mocks.features.knowledgeMemberAccess,
    mirroredAccessAvailable: mocks.features.knowledgeSourceMirroredAccess,
    hasMaxAccess: true,
  }),
}))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  useSearchIndex: (
    scope: { workspaceId?: string; organizationId?: string },
    options: { enabled: boolean }
  ) => {
    mocks.basesQuery(scope.workspaceId ?? scope.organizationId, options)
    return {
      data: { knowledgeBaseId: mocks.bases.find((base) => base.isSearchIndex)?.id ?? null },
      isPending: mocks.basesPending,
      isError: Boolean(mocks.basesError),
      error: mocks.basesError,
      isFetching: false,
      refetch: mocks.refetchBases,
    }
  },
  useCreateConnector: () => ({ mutate: mocks.create, isPending: mocks.createPending }),
  useUpdateConnector: () => ({ mutate: mocks.update, isPending: mocks.updatePending }),
  useUpdateConnectorAccess: () => ({ mutate: mocks.applyAccess, isPending: mocks.accessPending }),
  usePrepareSearchSource: () => ({
    mutate: mocks.prepare,
    data: mocks.prepareData,
    isPending: mocks.preparePending,
    error: mocks.prepareError,
  }),
  useConnectorList: (id?: string) => {
    mocks.connectorsQuery(id)
    return {
      data: mocks.connectors,
      isError: Boolean(mocks.connectorsError),
      error: mocks.connectorsError,
      isPending: mocks.connectorsPending,
      isSuccess: !mocks.connectorsPending && !mocks.connectorsError,
      isFetching: mocks.connectorsPending,
      refetch: mocks.refetchConnectors,
    }
  },
  useConnectorDocuments: () => ({ data: { documents: [], total: 0 }, isLoading: false }),
  useExcludeConnectorDocument: () => ({ mutate: vi.fn(), isPending: false }),
  useRestoreConnectorDocument: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/queries/oauth/oauth-credentials', () => ({
  useOAuthCredentials: () => ({
    data: mocks.credentials,
    isLoading: false,
    refetch: vi.fn(),
  }),
}))
vi.mock('@/hooks/queries/source-accounts', () => ({
  useSourceAccounts: () => ({
    data: { credentialGroup: mocks.credentialGroup },
    isLoading: false,
    isPending: false,
    isSuccess: true,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    error: null,
  }),
}))
vi.mock('@/hooks/queries/selectors', () => ({
  useSelectorOptions: () => ({ data: [], isLoading: false, loadMore: vi.fn(), loadAll: vi.fn() }),
  useSelectorOptionDetails: () => ({ data: [], isLoading: false }),
  useSelectorOptionDetail: () => ({ data: undefined }),
}))
vi.mock('@/hooks/use-credential-refresh-triggers', () => ({
  useCredentialRefreshTriggers: () => undefined,
}))

import type { ConnectorData } from '@/lib/api/contracts/knowledge/connectors'
import { SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'
import { SourceSetupModal } from '@/app/workspace/[workspaceId]/home/components/search-sources/source-setup-modal'
import { AddConnectorModal } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/add-connector-modal'
import { EditConnectorModal } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal'
import { SearchSourceSetup } from '@/app/workspace/[workspaceId]/search/components/search-source-setup'
import { useConnectorSetupStore } from '@/stores/connector-setup/store'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function render(node: ReactNode, searchParams = '') {
  if (!root) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  await act(async () =>
    root?.render(
      <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={mocks.urlUpdate}>
        {node}
      </NuqsTestingAdapter>
    )
  )
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll('button')).find(
    (node) => node.textContent?.trim() === label || node.getAttribute('aria-label') === label
  )
  expect(match, `Button ${label}`).toBeDefined()
  return match as HTMLButtonElement
}

async function click(element: HTMLElement) {
  await act(async () => element.click())
}

async function fill(placeholder: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)
  expect(input, `Input ${placeholder}`).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function chooseCombo(currentLabel: string, nextLabel: string) {
  const combo = Array.from(document.querySelectorAll<HTMLElement>('[role="combobox"]')).find(
    (node) => node.textContent?.includes(currentLabel)
  )
  expect(combo, `Combobox ${currentLabel}`).toBeDefined()
  await click(combo!)
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (node) => node.textContent?.trim() === nextLabel
  )
  expect(option, `Option ${nextLabel}`).toBeDefined()
  await act(async () => option?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
}

function connector(overrides: Partial<ConnectorData> = {}): ConnectorData {
  return {
    id: 'connector-1',
    knowledgeBaseId: 'kb-search',
    connectorType: 'slack',
    credentialId: null,
    sourceConfig: {},
    syncMode: 'full',
    syncIntervalMinutes: 1440,
    status: 'active',
    lastSyncAt: null,
    lastSyncError: null,
    lastSyncDocCount: null,
    nextSyncAt: null,
    consecutiveFailures: 0,
    accessMode: 'members',
    viewerMembership: null,
    credentialGroupId: 'group-1',
    credentialGroupOptionId: 'option-1',
    memberSyncStatus: 'idle',
    lastMemberSyncAt: null,
    nextMemberSyncAt: null,
    lastMemberSyncError: null,
    memberSyncConsecutiveFailures: 0,
    accessRewritePending: false,
    createdAt: '2026-09-04T00:00:00Z',
    updatedAt: '2026-09-04T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.userId = 'user-1'
  useConnectorSetupStore.getState().reset()
  mocks.canAdmin = true
  mocks.availabilityReady = true
  mocks.availabilityLoading = false
  mocks.availabilityError = null
  mocks.unavailableProviders = []
  mocks.features = { knowledgeMemberAccess: true, knowledgeSourceMirroredAccess: true }
  mocks.createPending = false
  mocks.updatePending = false
  mocks.accessPending = false
  mocks.basesPending = false
  mocks.basesError = null
  mocks.connectorsError = null
  mocks.connectorsPending = false
  mocks.preparePending = false
  mocks.prepareError = null
  mocks.prepareData = undefined
  mocks.bases = [{ id: 'kb-search', name: 'Sim Search', isSearchIndex: true }]
  mocks.connectors = []
  mocks.integrationAvailability.clear()
  mocks.credentials = [{ id: 'cred-source', name: 'Indexing account', provider: 'slack' }]
  mocks.credentialGroup = {
    id: 'group-1',
    name: 'Workspace accounts',
    status: 'active',
    options: [
      {
        id: 'option-1',
        label: 'Slack',
        provider: 'slack',
        status: 'active',
        configurationStatus: 'ready',
      },
    ],
  }
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.restoreAllMocks()
})

function setup() {
  return (
    <SearchSourceSetup
      workspaceId='workspace-1'
      canAdmin={mocks.canAdmin}
      memberAccessAvailable={mocks.features.knowledgeMemberAccess}
      mirroredAccessAvailable={mocks.features.knowledgeSourceMirroredAccess}
    />
  )
}

describe('Search source setup with real connector dialogs', () => {
  it.each([false, true])(
    'does not fetch admin data while closed for canAdmin=%s',
    async (canAdmin) => {
      mocks.canAdmin = canAdmin
      await render(setup())
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(mocks.basesQuery).toHaveBeenLastCalledWith('workspace-1', { enabled: false })
      expect(mocks.connectorsQuery).toHaveBeenLastCalledWith(undefined)
    }
  )

  it.each(['?addConnector=gitlab', '?manage-source=site-one', '?manage-source=confluence'])(
    'does not expose the catalog or admin queries to a reader opening %s',
    async (searchParams) => {
      mocks.canAdmin = false
      await render(setup(), searchParams)
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(mocks.basesQuery).toHaveBeenLastCalledWith('workspace-1', { enabled: false })
      expect(mocks.connectorsQuery).toHaveBeenLastCalledWith(undefined)
      expect(mocks.prepare).not.toHaveBeenCalled()
    }
  )

  it('closes source management and disables admin queries when the viewer loses admin access', async () => {
    mocks.connectors = [
      { id: 'site-one', connectorType: 'confluence', accessMode: 'admin', status: 'active' },
    ]
    await render(setup(), '?manage-source=site-one')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    mocks.canAdmin = false
    mocks.sourceStatus.mockClear()
    await render(setup(), '?manage-source=site-one')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.basesQuery).toHaveBeenLastCalledWith('workspace-1', { enabled: false })
    expect(mocks.connectorsQuery).toHaveBeenLastCalledWith(undefined)
    expect(mocks.sourceStatus).not.toHaveBeenCalled()
  })

  it('lists each eligible provider once and filters the add-source catalog', async () => {
    await render(setup(), '?addConnector=')
    expect(
      Array.from(document.querySelectorAll('button')).filter(
        (node) => node.textContent === 'Set up'
      )
    ).toHaveLength(8)
    for (const name of [
      'Confluence',
      'GitHub',
      'GitLab',
      'Gmail',
      'Google Calendar',
      'Google Drive',
      'Jira',
      'Slack',
    ]) {
      expect(document.body.textContent).toContain(name)
    }
    await fill('Find a source…', 'no-such-source')
    expect(document.body.textContent).toContain('No matching sources.')
    expect(document.body.textContent).not.toContain('Google Drive')
    expect(mocks.connectorsQuery).toHaveBeenLastCalledWith(undefined)
  })

  it('waits for availability and offers a retry after it fails', async () => {
    mocks.availabilityReady = false
    mocks.availabilityLoading = true
    await render(setup(), '?addConnector=')
    expect(document.body.textContent).toContain('Loading sources…')
    expect(
      Array.from(document.querySelectorAll('button')).some((node) => node.textContent === 'Set up')
    ).toBe(false)
    mocks.availabilityLoading = false
    mocks.availabilityError = new Error('Availability failed')
    await render(setup(), '?addConnector=')
    expect(document.body.textContent).toContain('Availability failed')
    await click(button('Try again'))
    expect(mocks.refetchAvailability).toHaveBeenCalledOnce()
  })

  it('does not offer GitHub App setup when only its workflow token integration is available', async () => {
    mocks.unavailableProviders = ['github-repositories']
    await render(setup(), '?addConnector=')
    expect(
      Array.from(document.querySelectorAll('button')).filter(
        (node) => node.textContent === 'Set up'
      )
    ).toHaveLength(7)
    expect(document.body.textContent).toContain('GitHub')
    expect(document.body.textContent).toContain('Not available in this workspace')
  })

  it('preserves a setup draft while an availability refresh fails and recovers', async () => {
    await render(setup(), '?addConnector=github')
    await fill('owner/repo', 'acme/docs')
    expect(button('Create & Invite').disabled).toBe(false)
    mocks.availabilityReady = false
    mocks.availabilityError = new Error('Availability refresh failed')
    await render(setup(), '?addConnector=github')
    expect(document.querySelector<HTMLInputElement>('input[placeholder="owner/repo"]')?.value).toBe(
      'acme/docs'
    )
    expect(button('Create & Invite').disabled).toBe(true)
    await click(button('Try again'))
    expect(mocks.refetchAvailability).toHaveBeenCalledOnce()
    mocks.availabilityReady = true
    mocks.availabilityError = null
    await render(setup(), '?addConnector=github')
    expect(button('Create & Invite').disabled).toBe(false)
  })

  it.each(['gmail', 'jira', 'github', 'google_calendar'])(
    'sets up %s with member access and no shared workspace or admin mode',
    async (type) => {
      await render(setup(), `?addConnector=${type}`)
      expect(document.body.textContent).toContain('Member accounts')
      expect(
        Array.from(document.querySelectorAll('button')).some((node) =>
          ['Workspace', 'Admin or service account'].includes(node.textContent ?? '')
        )
      ).toBe(false)
      expect(document.body.textContent).not.toContain('Sync Frequency')
      expect(document.body.textContent).not.toContain('Max Threads')
      expect(document.body.textContent).not.toContain('Max Events')
      expect(document.body.textContent).not.toContain('Max Files')
      expect(document.body.textContent).not.toContain('Max Issues')
      if (type === 'github') await fill('owner/repo', 'acme/docs')
      if (type === 'jira') {
        expect(button('Create & Invite').disabled).toBe(true)
        await fill('yoursite.atlassian.net', 'acme.atlassian.net')
        const modeToggle = document.querySelector<HTMLButtonElement>(
          'button[aria-label="Switch Projects to manual input"]'
        )
        expect(modeToggle).not.toBeNull()
        await click(modeToggle!)
        await fill('e.g. ENG, PROJ (comma-separated for multiple)', 'ENG')
      }
      if (type === 'gmail') {
        expect(document.body.textContent).not.toContain('Browse with')
        expect(
          document.querySelector('input[placeholder="e.g. INBOX, Engineering (comma-separated)"]')
        ).not.toBeNull()
        expect(document.querySelector('button[aria-label="Switch Labels to selector"]')).toBeNull()
      }
      expect(button('Create & Invite').disabled).toBe(false)
      await click(button('Create & Invite'))
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          knowledgeBaseId: 'kb-search',
          connectorType: type,
          accessMode: 'members',
        }),
        expect.any(Object)
      )
    }
  )

  it('prepares a canonical index instead of an ordinary base with the Search name', async () => {
    mocks.bases = [{ id: 'ordinary-base', name: 'Sim Search', isSearchIndex: false }]
    await render(setup(), '?addConnector=gitlab')
    await click(button('Continue setup'))
    expect(mocks.prepare).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', connectorType: 'gitlab', accessMode: 'admin' },
      expect.any(Object)
    )
    expect(mocks.connectorsQuery).toHaveBeenLastCalledWith(undefined)
  })

  it('prepares organization connected-account indexing in members mode even when central access is available', async () => {
    mocks.bases = []
    await render(
      <SearchSourceSetup
        scope={{ kind: 'organization', organizationId: 'org-1' }}
        canAdmin
        memberAccessAvailable
        mirroredAccessAvailable
        membersOnly
      />,
      '?addConnector=slack'
    )
    await click(button('Continue setup'))
    expect(mocks.prepare).toHaveBeenCalledWith(
      { organizationId: 'org-1', connectorType: 'slack', accessMode: 'members' },
      expect.any(Object)
    )
  })

  it('does not reuse mutation data after the current index has been removed', async () => {
    mocks.prepareData = { knowledgeBaseId: 'kb-search' }
    mocks.bases = []
    await render(setup(), '?addConnector=gitlab')
    await click(button('Continue setup'))
    expect(mocks.prepare).toHaveBeenCalled()
    expect(document.querySelector('input[placeholder="Enter your GitLab PAT"]')).toBeNull()
  })

  it.each(['bases', 'connectors'] as const)(
    'retries a failed %s discovery query',
    async (query) => {
      if (query === 'bases') mocks.basesError = new Error('Base discovery failed')
      else mocks.connectorsError = new Error('Connector discovery failed')
      await render(setup(), query === 'bases' ? '?addConnector=' : '?manage-source=gitlab-1')
      expect(document.body.textContent).toContain('discovery failed')
      await click(button('Try again'))
      expect(
        query === 'bases' ? mocks.refetchBases : mocks.refetchConnectors
      ).toHaveBeenCalledOnce()
    }
  )

  it('manages the exact source ID in a renamed canonical index', async () => {
    mocks.bases = [
      { id: 'ordinary-base', name: 'Sim Search', isSearchIndex: false },
      { id: 'renamed-index', name: 'Company knowledge', isSearchIndex: true },
    ]
    mocks.connectors = [
      { id: 'site-one', connectorType: 'confluence', accessMode: 'members', status: 'active' },
      { id: 'site-two', connectorType: 'confluence', accessMode: 'admin', status: 'active' },
    ]
    await render(setup(), '?manage-source=site-two')
    expect(mocks.connectorsQuery).toHaveBeenLastCalledWith('renamed-index')
    expect(mocks.sourceStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        knowledgeBaseId: 'renamed-index',
        connectorType: 'confluence',
        connectors: [mocks.connectors[1]],
      })
    )
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it.each(['unknown-source', 'deleted-source'])(
    'shows unavailable for a missing connector ID: %s',
    async (id) => {
      mocks.connectors = [
        {
          id: 'existing-source',
          connectorType: 'confluence',
          accessMode: 'members',
          status: 'active',
        },
      ]
      await render(setup(), `?manage-source=${id}`)
      expect(document.body.textContent).toContain('This source is no longer available.')
      expect(document.body.textContent).not.toContain('Source sync status')
      expect(mocks.sourceStatus).not.toHaveBeenCalled()
    }
  )

  it('waits for connector discovery before declaring a management link unavailable', async () => {
    mocks.connectorsPending = true
    await render(setup(), '?manage-source=site-one')
    expect(mocks.sourceStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ isLoading: true, connectors: [] })
    )
    expect(document.body.textContent).not.toContain('This source is no longer available.')
    mocks.connectorsPending = false
    mocks.connectors = [
      { id: 'site-one', connectorType: 'confluence', accessMode: 'members', status: 'active' },
    ]
    await render(setup(), '?manage-source=site-one')
    expect(document.body.textContent).toContain('Source sync status')
    expect(document.body.textContent).not.toContain('This source is no longer available.')
    expect(mocks.sourceStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ connectorType: 'confluence', connectors: mocks.connectors })
    )
  })

  it('keeps a failed connector lookup retryable instead of treating it as deletion', async () => {
    mocks.connectorsError = new Error('Source lookup failed')
    await render(setup(), '?manage-source=site-one')
    expect(document.body.textContent).toContain('Source lookup failed')
    expect(document.body.textContent).not.toContain('This source is no longer available.')
    expect(mocks.sourceStatus).not.toHaveBeenCalled()
    await click(button('Try again'))
    expect(mocks.refetchConnectors).toHaveBeenCalledOnce()
    mocks.connectorsError = null
    await render(setup(), '?manage-source=site-one')
    expect(document.body.textContent).toContain('This source is no longer available.')
  })

  it('preserves existing provider-based management URLs', async () => {
    mocks.connectors = [
      { id: 'site-one', connectorType: 'confluence', accessMode: 'members', status: 'active' },
      { id: 'site-two', connectorType: 'confluence', accessMode: 'admin', status: 'active' },
    ]
    await render(setup(), '?manage-source=confluence')
    expect(mocks.sourceStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ connectors: mocks.connectors })
    )
  })

  it('opens GitLab with its single central method and submits the custom host and PAT', async () => {
    await render(setup(), '?addConnector=gitlab')
    expect(document.body.textContent).toContain('Admin or service account')
    expect(document.body.textContent).not.toContain('Member accounts')
    expect(button('Connect & Sync')).toBeDisabled()
    await fill('Enter your GitLab PAT', 'test-pat')
    await fill('gitlab.com', 'gitlab.example.test')
    await fill('group/project or numeric ID', 'engineering/search')
    await click(button('Connect & Sync'))
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: 'kb-search',
        connectorType: 'gitlab',
        accessMode: 'admin',
        apiKey: 'test-pat',
        sourceConfig: expect.objectContaining({
          host: 'gitlab.example.test',
          project: 'engineering/search',
        }),
        syncIntervalMinutes: 60,
      }),
      expect.any(Object)
    )
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('credentialId')
  })

  it('prepares Slack in members mode when mirrored access is disabled', async () => {
    mocks.features.knowledgeSourceMirroredAccess = false
    mocks.bases = []
    await render(setup(), '?addConnector=slack')
    await click(button('Continue setup'))
    expect(mocks.prepare).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', connectorType: 'slack', accessMode: 'members' },
      expect.any(Object)
    )
  })

  it('blocks unavailable catalog providers and duplicate preparation while preserving retry feedback', async () => {
    mocks.features.knowledgeMemberAccess = false
    mocks.features.knowledgeSourceMirroredAccess = false
    await render(setup(), '?addConnector=')
    expect(document.body.textContent).toContain('Not available in this workspace')
    expect(
      Array.from(document.querySelectorAll('button')).some((node) => node.textContent === 'Set up')
    ).toBe(false)
    mocks.features.knowledgeSourceMirroredAccess = true
    mocks.bases = []
    mocks.preparePending = true
    mocks.prepareError = new Error('Source preparation failed')
    await render(setup(), '?addConnector=')
    await fill('Find a source…', 'gitlab')
    expect(button('Set up')).toBeDisabled()
    expect(document.body.textContent).toContain('Source preparation failed')
  })
})

describe('member content credentials in real add and edit dialogs', () => {
  it('links Slack setup to the existing app and credential-group screens when no ready option exists', async () => {
    mocks.credentialGroup = {
      id: 'group-1',
      name: 'Search',
      status: 'active',
      options: [
        {
          id: 'option-1',
          label: 'Slack',
          provider: 'slack',
          status: 'active',
          configurationStatus: 'pending',
        },
      ],
    }
    await render(
      <AddConnectorModal
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        initialConnectorType='slack'
        initialAccessMode='members'
      />
    )
    expect(document.body.textContent).toContain('Each teammate connects their Slack account.')
    expect(
      Array.from(document.querySelectorAll('a')).map((node) => node.getAttribute('href'))
    ).toEqual(['/workspace/workspace-1/settings/credential-groups'])
  })

  it.each([
    { status: 'disabled', optionStatus: 'active', provider: 'slack' },
    { status: 'active', optionStatus: 'disabled', provider: 'slack' },
    { status: 'active', optionStatus: 'active', provider: 'gmail' },
  ])(
    'offers Slack setup when the workspace provider is unavailable: %o',
    async ({ status, optionStatus, provider }) => {
      mocks.credentialGroup = {
        id: 'group-1',
        name: 'Workspace accounts',
        status,
        options: [
          {
            id: 'option-1',
            label: provider,
            provider,
            status: optionStatus,
            configurationStatus: 'ready',
          },
        ],
      }
      await render(
        <AddConnectorModal
          open
          onOpenChange={vi.fn()}
          knowledgeBaseId='kb-search'
          initialConnectorType='slack'
          initialAccessMode='members'
        />
      )
      expect(document.body.textContent).toContain('Set up Slack')
      expect(document.body.textContent).not.toContain('Choose member accounts')
    }
  )

  it('does not select a dedicated content credential just because one browse account exists', async () => {
    await render(
      <AddConnectorModal
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        initialConnectorType='slack'
        initialAccessMode='members'
      />
    )
    expect(document.body.textContent).toContain('Connected members')
    expect(document.body.textContent).not.toContain('Max Messages')
    await click(button('Create & Invite'))
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      connectorType: 'slack',
      accessMode: 'members',
    })
    expect(mocks.create.mock.calls[0][0].credentialId).toBeUndefined()
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('credentialGroupId')
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('credentialGroupOptionId')
  })

  it('submits a deliberately selected dedicated account and clears source-specific state on back', async () => {
    await render(
      <AddConnectorModal
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        initialConnectorType='slack'
        initialAccessMode='members'
      />
    )
    await chooseCombo('Connected members', 'Indexing account')
    await fill('e.g. hr, legal, C01ABC23DEF', 'legal')
    await click(button('Create & Invite'))
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      credentialId: 'cred-source',
      sourceConfig: { excludeChannels: 'legal' },
    })
    await click(button('Choose another source'))
    await fill('Search sources...', 'gitlab')
    const card = Array.from(document.querySelectorAll('button')).find(
      (node) => node.getAttribute('aria-label') === 'GitLab'
    )
    await click(card!)
    expect(document.body.textContent).not.toContain('Connected members')
    expect(button('Workspace')).toHaveAttribute('aria-checked', 'true')
    await fill('Enter your GitLab PAT', 'new-pat')
    await fill('group/project or numeric ID', '1')
    await click(button('Connect & Sync'))
    expect(mocks.create.mock.calls[1][0]).toMatchObject({
      connectorType: 'gitlab',
      accessMode: 'workspace',
      apiKey: 'new-pat',
    })
    expect(mocks.create.mock.calls[1][0].sourceConfig).not.toHaveProperty('excludeChannels')
    expect(mocks.create.mock.calls[1][0]).not.toHaveProperty('credentialId')
  })

  it('changes indexing authority without warning that the existing member group will lose access', async () => {
    await render(
      <EditConnectorModal
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        connector={connector()}
      />
    )
    await chooseCombo('Connected members', 'Indexing account')
    expect(document.body.textContent).not.toContain('Members of the previous group lose access')
    expect(button('Save')).toBeDisabled()
    await click(button('Change indexing account'))
    expect(mocks.applyAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: 'kb-search',
        connectorId: 'connector-1',
        access: {
          accessMode: 'members',
          credentialId: 'cred-source',
        },
      }),
      expect.any(Object)
    )
  })

  it('uses the configured workspace provider without a group selector and preserves its content account', async () => {
    mocks.credentialGroup = {
      id: 'group-1',
      name: 'Workspace accounts',
      status: 'active',
      options: [
        {
          id: 'option-1',
          label: 'Slack',
          provider: 'slack',
          status: 'active',
          configurationStatus: 'ready',
        },
      ],
    }
    await render(
      <EditConnectorModal
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        connector={connector({ credentialId: 'cred-source' })}
      />
    )
    expect(document.body.textContent).toContain('Indexing account')
    expect(document.body.textContent).not.toContain('Choose member accounts')
    expect(document.body.textContent).not.toContain('Change credential group')
    expect(document.body.textContent).not.toContain('Set up Slack')
    expect(button('Save')).toBeDisabled()
    expect(mocks.applyAccess).not.toHaveBeenCalled()
  })

  it('distinguishes content scheduling from permission checks and makes manual expiry visible', async () => {
    await render(
      <AddConnectorModal
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        initialConnectorType='slack'
        initialAccessMode='members'
      />
    )
    expect(document.body.textContent).toContain('Source permissions require a sync every hour')
    await chooseCombo('Connected members', 'Indexing account')
    expect(document.body.textContent).toContain(
      'Content follows this schedule. Member permissions are checked every hour.'
    )
    await click(button('Manual only'))
    expect(document.body.textContent).toContain('Documents become unavailable after 24 hours')
    await click(button('Every hour'))
    expect(document.body.textContent).toContain('Permissions are checked on every sync.')
  })

  it('saves source settings without changing a dedicated indexing account', async () => {
    await render(
      <EditConnectorModal
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        connector={connector({ credentialId: 'cred-source' })}
      />
    )
    await fill('e.g. hr, legal, C01ABC23DEF', 'legal')
    await click(button('Save'))
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorId: 'connector-1',
        updates: { sourceConfig: expect.objectContaining({ excludeChannels: 'legal' }) },
      }),
      expect.any(Object)
    )
    expect(mocks.applyAccess).not.toHaveBeenCalled()
  })

  it('sends explicit null when returning to connected members and locks access controls for readers', async () => {
    const existing = connector({ credentialId: 'cred-source' })
    await render(
      <EditConnectorModal
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        connector={existing}
      />
    )
    await chooseCombo('Indexing account', 'Connected members')
    await click(button('Change indexing account'))
    expect(mocks.applyAccess.mock.calls[0][0].access.credentialId).toBeNull()
    mocks.canAdmin = false
    await render(
      <EditConnectorModal
        key='reader'
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        connector={existing}
      />
    )
    const combo = Array.from(document.querySelectorAll('[role="combobox"]')).find((node) =>
      node.textContent?.includes('Indexing account')
    )
    expect(combo).toHaveAttribute('aria-disabled', 'true')
    expect(document.body.textContent).toContain('Member accounts')
    expect(
      Array.from(document.querySelectorAll('[role="radio"]')).filter((node) =>
        ['Workspace', 'Member accounts', 'Admin or service account'].includes(
          node.textContent ?? ''
        )
      )
    ).toHaveLength(0)
    expect(document.body.textContent).not.toContain('Change indexing account')
  })
})

describe('administrator source prerequisites in real connector dialogs', () => {
  const adminEmailPlaceholder = 'admin@yourcompany.com'
  const folderPlaceholder = 'e.g. 1aBcDeFg…, 2cDeFgHi… (comma-separated for multiple)'
  const driveCredential = {
    id: 'drive-credential',
    name: 'Drive indexing account',
    provider: 'google-drive',
    type: 'service_account' as const,
  }

  beforeEach(() => {
    mocks.credentials = [driveCredential]
  })

  it.each(['ready', 'limited', 'unavailable', 'misconfigured'] as const)(
    'uses canonical Confluence availability for inline service-account setup when %s',
    async (state) => {
      mocks.credentials = []
      mocks.integrationAvailability.set('confluence_v2', { oauthAvailable: true, state })
      await render(
        <AddConnectorModal
          open
          onOpenChange={vi.fn()}
          knowledgeBaseId='kb-search'
          isSearchIndex
          initialConnectorType='confluence'
          initialAccessMode='admin'
        />
      )
      const picker = Array.from(document.querySelectorAll<HTMLElement>('[role="combobox"]')).find(
        (node) => node.textContent?.includes('Select Confluence account')
      )
      expect(picker).toBeDefined()
      await click(picker!)
      const serviceAccountOption = Array.from(
        document.querySelectorAll<HTMLElement>('[role="option"]')
      ).find((node) => node.textContent?.trim() === 'Add service account')

      expect(Boolean(serviceAccountOption)).toBe(state === 'ready' || state === 'limited')
    }
  )

  it.each(['admin', 'workspace'] as const)(
    'offers inline Drive service-account setup only when a general KB requires it in %s mode',
    async (accessMode) => {
      mocks.credentials = []
      mocks.integrationAvailability.set('google_drive', { oauthAvailable: true, state: 'ready' })
      await render(
        <AddConnectorModal
          open
          onOpenChange={vi.fn()}
          knowledgeBaseId='kb-general'
          initialConnectorType='google_drive'
          initialAccessMode={accessMode}
        />
      )
      const picker = Array.from(document.querySelectorAll<HTMLElement>('[role="combobox"]')).find(
        (node) =>
          node.textContent?.includes(
            accessMode === 'admin' ? 'Select a service account' : 'Select Google Drive account'
          )
      )
      expect(picker).toBeDefined()
      await click(picker!)
      const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).map(
        (node) => node.textContent?.trim()
      )

      expect(options.includes('Add service account')).toBe(accessMode === 'admin')
      expect(options.includes('Connect Google Drive account')).toBe(accessMode === 'workspace')
    }
  )

  it('marks Crawl as required in Drive administrator mode and refuses empty or blank subjects', async () => {
    await render(
      <AddConnectorModal
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        isSearchIndex
        initialConnectorType='google_drive'
        initialAccessMode='admin'
      />
    )
    expect(document.body.textContent).toContain('Crawl as*')
    expect(button('Connect & Sync')).toBeDisabled()
    await click(button('Connect & Sync'))
    expect(mocks.create).not.toHaveBeenCalled()
    await fill(adminEmailPlaceholder, '   ')
    expect(button('Connect & Sync')).toBeDisabled()

    await fill(adminEmailPlaceholder, 'admin@example.com')
    expect(button('Connect & Sync')).toBeEnabled()
    await click(button('Connect & Sync'))
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorType: 'google_drive',
        accessMode: 'admin',
        credentialId: driveCredential.id,
        sourceConfig: expect.objectContaining({ adminEmail: 'admin@example.com' }),
      }),
      expect.any(Object)
    )
  })

  it('excludes personal OAuth accounts and stale OAuth drafts from Drive administrator setup', async () => {
    const oauthCredential = {
      id: 'drive-personal',
      name: 'Personal Drive account',
      provider: 'google-drive',
      type: 'oauth' as const,
    }
    mocks.credentials = [oauthCredential]
    const setupDraftKey = 'user-1:workspace-1:kb-search:google_drive'
    useConnectorSetupStore.getState().saveDraft(setupDraftKey, {
      sourceConfig: { adminEmail: 'admin@example.com' },
      canonicalModes: {},
      accessMode: 'admin',
      credentialId: oauthCredential.id,
      contentCredentialId: null,
      disabledTagIds: [],
      savedAt: Date.now(),
    })
    const modal = (
      <AddConnectorModal
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        isSearchIndex
        initialConnectorType='google_drive'
        setupDraftKey={setupDraftKey}
      />
    )
    await render(modal)
    expect(document.body.textContent).toContain('Service account')
    expect(document.body.textContent).not.toContain(oauthCredential.name)
    expect(button('Connect & Sync')).toBeDisabled()
    const picker = Array.from(document.querySelectorAll<HTMLElement>('[role="combobox"]')).find(
      (node) => node.textContent?.includes('Select a service account')
    )!
    await click(picker)
    expect(document.body.textContent).not.toContain('Connect Google Drive account')
    expect(document.body.textContent).not.toContain(oauthCredential.name)
    await click(picker)
    mocks.credentials = [oauthCredential, driveCredential]
    await render(cloneElement(modal))

    expect(button('Connect & Sync')).toBeEnabled()
    await click(button('Connect & Sync'))

    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ credentialId: driveCredential.id, accessMode: 'admin' }),
      expect.any(Object)
    )
  })

  it('replaces an existing Drive administrator account through the access operation', async () => {
    const oauthCredential = {
      id: 'drive-personal',
      name: 'Personal Drive account',
      provider: 'google-drive',
      type: 'oauth' as const,
    }
    const replacement = { ...driveCredential, id: 'drive-new', name: 'Replacement service account' }
    mocks.credentials = [oauthCredential, driveCredential, replacement]
    await render(
      <EditConnectorModal
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        isSearchIndex
        connector={connector({
          connectorType: 'google_drive',
          accessMode: 'admin',
          credentialId: driveCredential.id,
          sourceConfig: { adminEmail: 'admin@example.com' },
        })}
      />
    )
    const picker = Array.from(document.querySelectorAll<HTMLElement>('[role="combobox"]')).find(
      (node) => node.textContent?.includes(driveCredential.name)
    )!
    await click(picker)
    expect(document.body.textContent).not.toContain(oauthCredential.name)
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (node) => node.textContent?.trim() === replacement.name
    )!
    await act(async () => option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(button('Save')).toBeDisabled()
    expect(button('Change indexing account')).toBeEnabled()

    await click(button('Change indexing account'))

    expect(mocks.applyAccess).toHaveBeenCalledExactlyOnceWith(
      {
        knowledgeBaseId: 'kb-search',
        connectorId: 'connector-1',
        access: { accessMode: 'admin', credentialId: replacement.id },
      },
      expect.any(Object)
    )
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it.each(['members', 'workspace'] as const)(
    'keeps the Drive crawl subject optional in %s mode',
    async (accessMode) => {
      await render(
        <AddConnectorModal
          open
          onOpenChange={vi.fn()}
          knowledgeBaseId='general-kb'
          initialConnectorType='google_drive'
          initialAccessMode={accessMode}
        />
      )
      const subjectLabel = accessMode === 'members' ? 'Sync documents with' : 'Crawl as'
      expect(document.body.textContent).toContain(subjectLabel)
      expect(document.body.textContent).not.toContain(`${subjectLabel}*`)
      const submit = button(accessMode === 'members' ? 'Create & Invite' : 'Connect & Sync')
      expect(submit).toBeEnabled()
      await click(submit)
      expect(mocks.create.mock.calls[0][0]).toMatchObject({
        knowledgeBaseId: 'general-kb',
        connectorType: 'google_drive',
        accessMode,
      })
      expect(mocks.create.mock.calls[0][0].sourceConfig.adminEmail).toBeFalsy()
    }
  )

  it('does not let an administrator erase the crawl subject from an existing mirrored Drive source', async () => {
    await render(
      <EditConnectorModal
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        isSearchIndex
        connector={connector({
          connectorType: 'google_drive',
          accessMode: 'admin',
          credentialId: driveCredential.id,
          sourceConfig: { adminEmail: 'admin@example.com', fileType: 'documents' },
        })}
      />
    )
    expect(document.body.textContent).toContain('Crawl as*')
    await fill(adminEmailPlaceholder, '')
    expect(button('Save')).toBeDisabled()
    await click(button('Save'))
    expect(mocks.update).not.toHaveBeenCalled()
    await fill(adminEmailPlaceholder, 'replacement@example.com')
    expect(button('Save')).toBeEnabled()
    await click(button('Save'))
    expect(mocks.update.mock.calls[0][0]).toMatchObject({
      connectorId: 'connector-1',
      updates: {
        sourceConfig: {
          adminEmail: 'replacement@example.com',
          fileType: 'documents',
        },
      },
    })
    expect(mocks.applyAccess).not.toHaveBeenCalled()
  })

  it('guides a member source back to saving its crawl subject without losing drafts or combining mutations', async () => {
    const existing = connector({
      connectorType: 'google_drive',
      sourceConfig: { folderId: 'original-folder', _canonicalModes: { folderId: 'advanced' } },
    })
    await render(
      <EditConnectorModal
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        isSearchIndex
        connector={existing}
      />
    )
    await fill(folderPlaceholder, 'draft-folder')
    await click(button('Service account'))
    expect(document.body.textContent).toContain(
      'Set Crawl as and save your settings before changing the connection method.'
    )
    expect(button('Apply connection method')).toBeDisabled()
    expect(button('Save')).toBeDisabled()
    await fill(adminEmailPlaceholder, 'admin@example.com')
    expect(button('Apply connection method')).toBeDisabled()
    await click(button('Edit settings'))

    expect(button('Member accounts')).toHaveAttribute('aria-checked', 'true')
    expect(document.querySelector(`input[placeholder="${folderPlaceholder}"]`)).toHaveValue(
      'draft-folder'
    )
    expect(document.querySelector(`input[placeholder="${adminEmailPlaceholder}"]`)).toHaveValue(
      'admin@example.com'
    )
    expect(button('Save')).toBeEnabled()
    await click(button('Save'))
    expect(mocks.update).toHaveBeenCalledOnce()
    expect(mocks.update.mock.calls[0][0]).toMatchObject({
      updates: {
        sourceConfig: {
          adminEmail: 'admin@example.com',
          folderId: ['draft-folder'],
          _canonicalModes: { folderId: 'advanced' },
        },
      },
    })
    expect(mocks.applyAccess).not.toHaveBeenCalled()

    await render(
      <EditConnectorModal
        key='saved-settings'
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        isSearchIndex
        connector={connector({
          ...existing,
          sourceConfig: mocks.update.mock.calls[0][0].updates.sourceConfig,
        })}
      />
    )
    await click(button('Service account'))
    await chooseCombo('Select the account to sync as', driveCredential.name)
    expect(button('Apply connection method')).toBeEnabled()
    await click(button('Apply connection method'))
    expect(mocks.applyAccess).toHaveBeenCalledExactlyOnceWith(
      {
        knowledgeBaseId: 'kb-search',
        connectorId: existing.id,
        access: { accessMode: 'admin', credentialId: driveCredential.id },
      },
      expect.any(Object)
    )
    expect(mocks.update).toHaveBeenCalledOnce()
  })

  it('does not offer Confluence administrator access while its member identity feature is unavailable', async () => {
    mocks.features.knowledgeMemberAccess = false
    await render(
      <EditConnectorModal
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        isSearchIndex
        connector={connector({
          connectorType: 'confluence',
          sourceConfig: { domain: 'team.atlassian.net', spaceKey: 'ENG' },
        })}
      />
    )
    expect(document.body.textContent).toContain('Member accounts')
    expect(
      Array.from(document.querySelectorAll('button')).some((node) =>
        ['Admin or service account', 'Apply connection method'].includes(node.textContent ?? '')
      )
    ).toBe(false)
    expect(mocks.applyAccess).not.toHaveBeenCalled()
  })

  it('blocks an already selected Confluence administrator transition when identity access becomes unavailable', async () => {
    mocks.credentials = [
      { id: 'confluence-account', name: 'Confluence indexing account', provider: 'confluence' },
    ]
    const existing = connector({
      connectorType: 'confluence',
      sourceConfig: { domain: 'team.atlassian.net', spaceKey: 'ENG' },
    })
    const modal = (
      <EditConnectorModal
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        isSearchIndex
        connector={existing}
      />
    )
    await render(modal)
    await click(button('Admin or service account'))
    await chooseCombo('Select the account to sync as', 'Confluence indexing account')
    expect(button('Apply connection method')).toBeEnabled()
    mocks.features.knowledgeMemberAccess = false
    await render(cloneElement(modal))
    expect(button('Apply connection method')).toBeDisabled()
    await click(button('Apply connection method'))
    expect(mocks.applyAccess).not.toHaveBeenCalled()
  })

  it.each(['creating', 'saving', 'switching access'] as const)(
    'disables generic source inputs, dropdowns, selectors, and mode toggles while %s',
    async (phase) => {
      mocks.createPending = phase === 'creating'
      mocks.updatePending = phase === 'saving'
      mocks.accessPending = phase === 'switching access'
      await render(
        phase === 'creating' ? (
          <AddConnectorModal
            open
            onOpenChange={vi.fn()}
            knowledgeBaseId='kb-search'
            isSearchIndex
            initialConnectorType='google_drive'
            initialAccessMode='admin'
          />
        ) : (
          <EditConnectorModal
            open
            onOpenChange={vi.fn()}
            knowledgeBaseId='kb-search'
            isSearchIndex
            connector={connector({
              connectorType: 'google_drive',
              accessMode: 'admin',
              credentialId: driveCredential.id,
              sourceConfig: { adminEmail: 'admin@example.com' },
            })}
          />
        )
      )
      expect(document.querySelector(`input[placeholder="${adminEmailPlaceholder}"]`)).toBeDisabled()
      expect(button('Switch Folders to manual input')).toBeDisabled()
      const dropdown = Array.from(document.querySelectorAll('[role="combobox"]')).find((node) =>
        node.textContent?.includes('Select file type')
      )
      expect(dropdown).toHaveAttribute('aria-disabled', 'true')
      const folders = Array.from(document.querySelectorAll('[role="combobox"]')).find((node) =>
        node.textContent?.includes('Select one or more folders (optional)')
      )
      expect(folders).toHaveAttribute('aria-disabled', 'true')
    }
  )
})

describe('canonical Search connector safety', () => {
  it('offers only reviewed source types, including when a deep link names an unsupported provider', async () => {
    await render(
      <AddConnectorModal
        open
        onOpenChange={() => {}}
        knowledgeBaseId='kb-search'
        isSearchIndex
        initialConnectorType='airtable'
      />
    )
    const sourceButtons = Array.from(document.querySelectorAll('button')).filter((node) =>
      [
        'Confluence',
        'GitHub',
        'GitLab',
        'Gmail',
        'Google Calendar',
        'Google Drive',
        'Jira',
        'Slack',
        'Airtable',
        'Google Chat',
      ].some((name) => node.getAttribute('aria-label') === name)
    )
    expect(sourceButtons.map((node) => node.getAttribute('aria-label'))).toHaveLength(8)
    expect(sourceButtons.some((node) => node.getAttribute('aria-label') === 'Airtable')).toBe(false)
    expect(sourceButtons.some((node) => node.getAttribute('aria-label') === 'Google Chat')).toBe(
      false
    )
  })

  it('defaults an OAuth source to member accounts and never offers workspace-wide access', async () => {
    await render(
      <AddConnectorModal
        open
        onOpenChange={() => {}}
        knowledgeBaseId='kb-search'
        isSearchIndex
        initialConnectorType='google_drive'
      />
    )
    expect(button('Member accounts')).toHaveAttribute('aria-checked', 'true')
    expect(
      Array.from(document.querySelectorAll('button')).some(
        (node) => node.textContent === 'Workspace'
      )
    ).toBe(false)
    expect(document.body.textContent).not.toContain('Everyone in this workspace')
    await click(button('Choose another source'))
    const gitlab = Array.from(document.querySelectorAll('button')).find(
      (node) => node.getAttribute('aria-label') === 'GitLab'
    )
    expect(gitlab).toBeDefined()
    await click(gitlab!)
    expect(document.body.textContent).toContain('Admin or service account')
    expect(document.querySelector('[role="radio"][aria-checked="true"]')).toBeNull()
    expect(
      Array.from(document.querySelectorAll('button')).some(
        (node) => node.textContent === 'Workspace'
      )
    ).toBe(false)
    await fill('Enter your GitLab PAT', 'fixture-pat')
    await fill('gitlab.com', 'gitlab.example.test')
    await fill('group/project or numeric ID', 'engineering/search')
    await click(button('Connect & Sync'))
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ accessMode: 'admin', connectorType: 'gitlab' }),
      expect.any(Object)
    )
  })

  it('keeps an existing Search member source out of workspace-wide mode', async () => {
    await render(
      <EditConnectorModal
        open
        onOpenChange={() => {}}
        knowledgeBaseId='kb-search'
        isSearchIndex
        connector={connector()}
      />
    )
    expect(document.body.textContent).toContain('Member accounts')
    expect(
      Array.from(document.querySelectorAll('[role="radio"]')).filter((node) =>
        ['Workspace', 'Member accounts', 'Admin or service account'].includes(
          node.textContent ?? ''
        )
      )
    ).toHaveLength(0)
    expect(
      Array.from(document.querySelectorAll('button')).some(
        (node) => node.textContent === 'Workspace'
      )
    ).toBe(false)
    expect(document.body.textContent).not.toContain('Everyone in this workspace')
  })
})

describe('resuming Search source setup', () => {
  const key = 'user-1:workspace-1:kb-search:slack'

  it('reopens the source from the URL even when the source filter hides its row', async () => {
    await render(setup(), '?search=nothing-matches&addConnector=gitlab&credentialDraftId=draft-1')
    expect(document.body.textContent).toContain('Admin or service account')
    expect(document.querySelector('[role="radio"][aria-checked="true"]')).toBeNull()
    expect(document.body.textContent).toContain('Configure GitLab')
    expect(document.body.textContent).not.toContain('Sync Frequency')
    expect(document.body.textContent).not.toContain('Sync automatically')
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('keeps the picker open when changing sources and updates the configuration selection', async () => {
    await render(setup(), '?addConnector=google_drive')
    await click(button('Choose another source'))
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Add source')
    await fill('Find a source…', 'confluence')
    await click(button('Set up'))
    expect(document.body.textContent).toContain('Configure Confluence')
  })

  it('restores the source configuration and content account after an account-settings detour', async () => {
    const onCreated = vi.fn()
    const form = (
      <AddConnectorModal
        open
        onOpenChange={vi.fn()}
        onCreated={onCreated}
        knowledgeBaseId='kb-search'
        isSearchIndex
        initialConnectorType='slack'
        initialAccessMode='members'
        setupDraftKey={key}
      />
    )
    await render(form)
    await chooseCombo('Connected members', 'Indexing account')
    await fill('e.g. hr, legal, C01ABC23DEF', 'legal')
    mocks.credentialGroup = null
    await render(cloneElement(form))
    const setup = Array.from(document.querySelectorAll('a')).find(
      (link) => link.textContent === 'Set up Slack'
    )
    expect(setup?.getAttribute('href')).toContain('search-setup=slack')
    setup?.addEventListener('click', (event) => event.preventDefault())
    await click(setup!)
    expect(useConnectorSetupStore.getState().getDraft(key)).toMatchObject({
      sourceConfig: { excludeChannels: 'legal' },
      contentCredentialId: 'cred-source',
      accessMode: 'members',
    })
    await act(async () => root?.unmount())
    root = null
    container?.remove()
    await useConnectorSetupStore.persist.rehydrate()
    mocks.credentialGroup = {
      id: 'group-1',
      name: 'Workspace accounts',
      status: 'active',
      options: [
        {
          id: 'option-1',
          label: 'Slack',
          provider: 'slack',
          status: 'active',
          configurationStatus: 'ready',
        },
      ],
    }
    await render(form)
    expect(
      document.querySelector<HTMLInputElement>('input[placeholder="e.g. hr, legal, C01ABC23DEF"]')
        ?.value
    ).toBe('legal')
    expect(document.body.textContent).not.toContain('Connected members')
    await click(button('Create & Invite'))
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      syncIntervalMinutes: 60,
      credentialId: 'cred-source',
      sourceConfig: { excludeChannels: 'legal' },
    })
    await act(async () => mocks.create.mock.calls[0][1].onSuccess())
    expect(onCreated).toHaveBeenCalledWith('slack')
    expect(useConnectorSetupStore.getState().getDraft(key)).toBeUndefined()
  })

  it('selects the verified OAuth account instead of the previously selected one', async () => {
    mocks.credentials = [
      { id: 'cred-source', name: 'Old account', provider: 'google_drive' },
      { id: 'cred-new', name: 'New account', provider: 'google_drive' },
    ]
    await render(
      <AddConnectorModal
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        isSearchIndex
        initialConnectorType='google_drive'
      />
    )
    await act(async () => mocks.oauthReturn.mock.calls.at(-1)?.[1]('cred-new'))
    const account = document.querySelector('[role="combobox"]')
    expect(account?.textContent).toContain('New account')
  })

  it('keeps the general KB schedule and both document-detail sections collapsed by default', async () => {
    await render(
      <AddConnectorModal
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='ordinary-kb'
        initialConnectorType='google_drive'
      />
    )
    expect(document.body.textContent).toContain('Sync Frequency')
    expect(button('Live')).toBeDefined()
    expect(button('Document details (optional)')).toHaveAttribute('aria-expanded', 'false')
    await click(button('Document details (optional)'))
    expect(document.body.textContent).toContain('Metadata tags')
    await render(
      <AddConnectorModal
        key='search'
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        isSearchIndex
        initialConnectorType='google_drive'
      />
    )
    expect(document.body.textContent).not.toContain('Sync Frequency')
    expect(button('Document details (optional)')).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('Search setup guides', () => {
  it('opens the source guide in a new tab without losing an administrator’s setup', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await render(setup(), '?addConnector=github')
    await fill('owner/repo', 'acme/docs')

    await click(button('Setup guide'))

    expect(open).toHaveBeenCalledWith(
      'https://docs.sim.ai/search/github',
      '_blank',
      'noopener,noreferrer'
    )
    expect(document.querySelector<HTMLInputElement>('input[placeholder="owner/repo"]')?.value).toBe(
      'acme/docs'
    )
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.urlUpdate).not.toHaveBeenCalled()
    await click(button('Create & Invite'))
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorType: 'github',
        sourceConfig: expect.objectContaining({ repository: 'acme/docs' }),
      }),
      expect.any(Object)
    )
  })

  it('offers the Slack guide before its custom app is configured', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    mocks.credentialGroup = null
    await render(setup(), '?addConnector=slack')

    await click(button('Setup guide'))

    expect(open).toHaveBeenCalledWith(
      'https://docs.sim.ai/search/slack',
      '_blank',
      'noopener,noreferrer'
    )
    expect(document.body.textContent).not.toContain('Create & Invite')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('preserves a member’s required source fields while reading the guide', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const onClose = vi.fn()
    const onConnect = vi.fn()
    const github = SEARCH_CONNECTORS.find((item) => item.type === 'github')!
    await render(<SourceSetupModal connector={github} onClose={onClose} onConnect={onConnect} />)
    await fill('owner/repo', 'acme/docs')

    await click(button('Setup guide'))

    expect(open).toHaveBeenCalledWith(
      'https://docs.sim.ai/search/github',
      '_blank',
      'noopener,noreferrer'
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(onConnect).not.toHaveBeenCalled()
    await click(button('Connect'))
    expect(onConnect).toHaveBeenCalledWith({ repository: 'acme/docs' })
    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLInputElement>('input[placeholder="owner/repo"]')?.value).toBe(
      'acme/docs'
    )
  })

  it('keeps unsaved source edits when opening the guide', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const onOpenChange = vi.fn()
    await render(
      <EditConnectorModal
        open
        onOpenChange={onOpenChange}
        knowledgeBaseId='kb-search'
        isSearchIndex
        connector={connector({
          connectorType: 'github',
          sourceConfig: { repository: 'acme/docs' },
        })}
      />
    )
    await fill('owner/repo', 'acme/handbook')

    await click(button('Setup guide'))

    expect(open).toHaveBeenCalledWith(
      'https://docs.sim.ai/search/github',
      '_blank',
      'noopener,noreferrer'
    )
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    await click(button('Save'))
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        updates: expect.objectContaining({
          sourceConfig: expect.objectContaining({ repository: 'acme/handbook' }),
        }),
      }),
      expect.any(Object)
    )
  })

  it.each(['add', 'edit'])('does not show Search guides in general KB %s dialogs', async (mode) => {
    await render(
      mode === 'add' ? (
        <AddConnectorModal
          open
          onOpenChange={vi.fn()}
          knowledgeBaseId='kb-general'
          initialType='github'
        />
      ) : (
        <EditConnectorModal
          open
          onOpenChange={vi.fn()}
          knowledgeBaseId='kb-general'
          connector={connector({
            connectorType: 'github',
            sourceConfig: { repository: 'acme/docs' },
          })}
        />
      )
    )

    expect(document.body.textContent).not.toContain('Setup guide')
  })
})
