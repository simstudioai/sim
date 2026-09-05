/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAdmin: true,
  features: { knowledgeMemberAccess: true, knowledgeSourceMirroredAccess: true },
  create: vi.fn(),
  update: vi.fn(),
  applyAccess: vi.fn(),
  prepare: vi.fn(),
  createPending: false,
  accessPending: false,
  basesPending: false,
  basesError: null as Error | null,
  connectorsError: null as Error | null,
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
  connectors: [] as { connectorType: string; accessMode: string; status: string }[],
  credentials: [{ id: 'cred-source', name: 'Indexing account', provider: 'slack' }],
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
vi.mock('@/hooks/queries/kb/connectors', () => ({
  useCreateConnector: () => ({ mutate: mocks.create, isPending: mocks.createPending }),
  useUpdateConnector: () => ({ mutate: mocks.update, isPending: false }),
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
      isPending: false,
      isFetching: false,
      refetch: mocks.refetchConnectors,
    }
  },
  useConnectorDocuments: () => ({ data: { documents: [], total: 0 }, isLoading: false }),
  useExcludeConnectorDocument: () => ({ mutate: vi.fn(), isPending: false }),
  useRestoreConnectorDocument: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/queries/kb/knowledge', () => ({
  useKnowledgeBasesQuery: (id: string, options: { enabled: boolean }) => {
    mocks.basesQuery(id, options)
    return {
      data: mocks.bases,
      isPending: mocks.basesPending,
      isError: Boolean(mocks.basesError),
      error: mocks.basesError,
      isFetching: false,
      refetch: mocks.refetchBases,
    }
  },
}))
vi.mock('@/hooks/queries/oauth/oauth-credentials', () => ({
  useOAuthCredentials: () => ({
    data: mocks.credentials,
    isLoading: false,
    refetch: vi.fn(),
  }),
}))
vi.mock('@/hooks/queries/credential-groups', () => ({
  useWorkspaceAccounts: () => ({
    data: { credentialGroup: mocks.credentialGroup },
    isLoading: false,
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
import { MANAGED_SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'
import { AddConnectorModal } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/add-connector-modal'
import { EditConnectorModal } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal'
import { ManagedSearchSources } from '@/app/workspace/[workspaceId]/search/components/managed-search-sources'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function render(node: ReactNode) {
  if (!root) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  await act(async () => root?.render(node))
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
  mocks.canAdmin = true
  mocks.features = { knowledgeMemberAccess: true, knowledgeSourceMirroredAccess: true }
  mocks.createPending = false
  mocks.accessPending = false
  mocks.basesPending = false
  mocks.basesError = null
  mocks.connectorsError = null
  mocks.preparePending = false
  mocks.prepareError = null
  mocks.prepareData = undefined
  mocks.bases = [{ id: 'kb-search', name: 'Sim Search', isSearchIndex: true }]
  mocks.connectors = []
  mocks.credentials = [{ id: 'cred-source', name: 'Indexing account', provider: 'slack' }]
  mocks.credentialGroup = null
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
})

describe('managed search setup with real connector dialogs', () => {
  it('prepares a canonical index when only an ordinary base has the Search name', async () => {
    mocks.bases = [{ id: 'ordinary-base', name: 'Sim Search', isSearchIndex: false }]
    await render(
      <ManagedSearchSources workspaceId='workspace-1' canAdmin available search='gitlab' />
    )
    expect(mocks.connectorsQuery).toHaveBeenLastCalledWith(undefined)
    await click(button('Set up'))
    expect(mocks.prepare).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', connectorType: 'gitlab' },
      expect.any(Object)
    )
  })

  it('does not reuse a prepared index after the current base list removes it', async () => {
    mocks.prepareData = { knowledgeBaseId: 'kb-search' }
    await render(
      <ManagedSearchSources workspaceId='workspace-1' canAdmin available search='gitlab' />
    )
    mocks.bases = []
    await render(
      <ManagedSearchSources workspaceId='workspace-1' canAdmin available search='gitlab' />
    )
    expect(mocks.connectorsQuery).toHaveBeenLastCalledWith(undefined)
    await click(button('Set up'))
    expect(mocks.prepare).toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it.each(['bases', 'connectors'] as const)(
    'shows retry feedback for a failed %s query',
    async (query) => {
      if (query === 'bases') mocks.basesError = new Error('Base discovery failed')
      else mocks.connectorsError = new Error('Connector discovery failed')
      await render(
        <ManagedSearchSources workspaceId='workspace-1' canAdmin available search='gitlab' />
      )
      expect(document.body.textContent).toContain('discovery failed')
      expect(document.body.textContent).not.toContain('Set up')
      await click(button('Try again'))
      expect(query === 'bases' ? mocks.refetchBases : mocks.refetchConnectors).toHaveBeenCalled()
    }
  )

  it('keeps using the renamed workspace search index over an ordinary base with its former name', async () => {
    mocks.bases = [
      { id: 'ordinary-base', name: 'Sim Search', isSearchIndex: false },
      { id: 'renamed-index', name: 'Company knowledge', isSearchIndex: true },
    ]
    mocks.connectors = [{ connectorType: 'gitlab', accessMode: 'admin', status: 'active' }]
    await render(
      <ManagedSearchSources workspaceId='workspace-1' canAdmin available search='gitlab' />
    )
    expect(mocks.connectorsQuery).toHaveBeenLastCalledWith('renamed-index')
    expect(document.querySelector('a')?.getAttribute('href')).toBe(
      '/workspace/workspace-1/knowledge/renamed-index'
    )
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
  it('lists each supported source once, hides nonmatches, and limits management to admins', async () => {
    await render(<ManagedSearchSources workspaceId='workspace-1' canAdmin available search='' />)
    expect(document.querySelectorAll('button')).toHaveLength(MANAGED_SEARCH_CONNECTORS.length)
    for (const { meta } of MANAGED_SEARCH_CONNECTORS)
      expect(document.body.textContent).toContain(meta.name)
    expect(document.body.textContent).not.toContain('Slack')
    await render(
      <ManagedSearchSources
        workspaceId='workspace-1'
        canAdmin
        available
        search='no-such-provider'
      />
    )
    expect(container?.textContent).toBe('')
    await render(
      <ManagedSearchSources workspaceId='workspace-1' canAdmin={false} available search='gitlab' />
    )
    expect(document.body.textContent).toContain('Ask a workspace admin')
    expect(document.querySelector('button')).toBeNull()
    expect(mocks.basesQuery).toHaveBeenLastCalledWith('workspace-1', { enabled: false })
    expect(mocks.connectorsQuery).toHaveBeenLastCalledWith(undefined)
  })

  it('opens GitLab with mirrored access and submits the custom host and PAT, never member mode', async () => {
    await render(
      <ManagedSearchSources workspaceId='workspace-1' canAdmin available search='gitlab' />
    )
    await click(button('Set up'))
    expect(button('Source permissions')).toHaveAttribute('aria-checked', 'true')
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

  it('shows configured mirrored sources only and blocks duplicate setup while preparation runs', async () => {
    mocks.connectors = [
      { connectorType: 'gitlab', accessMode: 'workspace', status: 'active' },
      { connectorType: 'gitlab', accessMode: 'admin', status: 'error' },
      { connectorType: 'gitlab', accessMode: 'admin', status: 'error' },
    ]
    mocks.preparePending = true
    mocks.prepareError = new Error('Source preparation failed')
    await render(
      <ManagedSearchSources workspaceId='workspace-1' canAdmin available search='gitlab' />
    )
    expect(document.body.textContent).toContain('2 sources connected · error')
    expect(document.body.textContent).not.toContain('error, error')
    expect(document.querySelector('a')?.getAttribute('href')).toBe(
      '/workspace/workspace-1/knowledge/kb-search'
    )
    expect(button('Add source')).toBeDisabled()
    expect(document.body.textContent).toContain('Source preparation failed')
    await render(
      <ManagedSearchSources workspaceId='workspace-1' canAdmin available={false} search='gitlab' />
    )
    expect(document.querySelector('button')).toBeNull()
    expect(document.body.textContent).not.toContain('source connected')
    expect(mocks.connectorsQuery).toHaveBeenLastCalledWith(undefined)
    await render(
      <ManagedSearchSources workspaceId='workspace-1' canAdmin={false} available search='gitlab' />
    )
    expect(document.body.textContent).not.toContain('source connected')
    expect(document.querySelector('a')).toBeNull()
  })

  it('creates the search knowledge base before opening its first source and relays setup errors', async () => {
    mocks.bases = []
    await render(
      <ManagedSearchSources workspaceId='workspace-1' canAdmin available search='gitlab' />
    )
    await click(button('Set up'))
    expect(mocks.prepare).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', connectorType: 'gitlab' },
      expect.any(Object)
    )
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    mocks.prepareError = new Error('Cannot prepare this source')
    await render(
      <ManagedSearchSources workspaceId='workspace-1' canAdmin available search='gitlab' />
    )
    expect(document.body.textContent).toContain('Cannot prepare this source')
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
    expect(document.body.textContent).toContain('Each member connects their own Slack account')
    expect(
      Array.from(document.querySelectorAll('a')).map((node) => node.getAttribute('href'))
    ).toEqual([
      '/workspace/workspace-1/integrations/slack',
      '/workspace/workspace-1/settings/credential-groups',
    ])
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
      expect(document.body.textContent).toContain('Configure member sign-in')
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
    const card = Array.from(document.querySelectorAll('button')).find((node) =>
      node.textContent?.startsWith('GitLab')
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
    expect(document.body.textContent).not.toContain('Configure member sign-in')
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
    expect(button('Member accounts')).toBeDisabled()
    expect(document.body.textContent).not.toContain('Change indexing account')
  })
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
      ['Confluence', 'GitLab', 'Google Drive', 'Slack', 'Airtable', 'Google Chat'].some((name) =>
        node.textContent?.startsWith(name)
      )
    )
    expect(sourceButtons.map((node) => node.textContent)).toHaveLength(4)
    expect(sourceButtons.some((node) => node.textContent?.startsWith('Airtable'))).toBe(false)
    expect(sourceButtons.some((node) => node.textContent?.startsWith('Google Chat'))).toBe(false)
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
    const gitlab = Array.from(document.querySelectorAll('button')).find((node) =>
      node.textContent?.startsWith('GitLab')
    )
    expect(gitlab).toBeDefined()
    await click(gitlab!)
    expect(button('Source permissions')).toHaveAttribute('aria-checked', 'true')
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
    expect(button('Member accounts')).toHaveAttribute('aria-checked', 'true')
    expect(
      Array.from(document.querySelectorAll('button')).some(
        (node) => node.textContent === 'Workspace'
      )
    ).toBe(false)
    expect(document.body.textContent).not.toContain('Everyone in this workspace')
  })
})
