/**
 * @vitest-environment jsdom
 */
import type { ButtonHTMLAttributes, ReactNode, SVGProps } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SyncLogData } from '@/lib/api/contracts/knowledge/connectors'
import { CONNECTOR_SYNC_STALE_LOCK_TTL_MS } from '@/lib/knowledge/connectors/sync-limits'

const {
  consumeOAuthReturnContextMock,
  connectOAuthModalMock,
  credentialRefreshTriggersMock,
  icon,
  oauthCredentialsState,
} = vi.hoisted(() => ({
  consumeOAuthReturnContextMock: vi.fn(),
  connectOAuthModalMock: vi.fn(),
  credentialRefreshTriggersMock: vi.fn(),
  icon: (name: string) => (props: SVGProps<SVGSVGElement>) => (
    <svg data-testid={`icon-${name}`} className={props.className} />
  ),
  oauthCredentialsState: {
    current: [] as Array<{ id: string; name: string; provider: string }>,
    isFetching: false,
  },
}))

vi.mock('@sim/emcn/icons', () => ({
  ChevronDown: icon('chevron-down'),
  ChevronUp: icon('chevron-up'),
  CircleAlert: icon('circle-alert'),
  CircleCheck: icon('circle-check'),
  CircleX: icon('circle-x'),
  Loader: icon('loader'),
  Pause: icon('pause'),
  Play: icon('play'),
  RefreshCw: icon('refresh-cw'),
  Settings: icon('settings'),
  Trash: icon('trash'),
  TriangleAlert: icon('triangle-alert'),
}))

vi.mock('@sim/emcn', () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Chip: ({
    children,
    variant: _variant,
    leftIcon: _leftIcon,
    fullWidth: _fullWidth,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string
    leftIcon?: unknown
    fullWidth?: boolean
  }) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
  Checkbox: () => <input type='checkbox' />,
  ChipConfirmModal: () => null,
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  DropdownMenu: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  OverflowText: ({ label, children }: { label: string; children?: ReactNode }) => (
    <span>{children ?? label}</span>
  ),
  Tooltip: {
    Root: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Trigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Content: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  },
}))

vi.mock('@/lib/credentials/client-state', () => ({
  consumeOAuthReturnContext: consumeOAuthReturnContextMock,
  writeOAuthReturnContext: vi.fn(),
}))
vi.mock('@/lib/oauth', () => ({
  getCanonicalScopesForProvider: vi.fn(() => []),
  getProviderIdFromServiceId: vi.fn(() => 'slack'),
}))
vi.mock('@/lib/oauth/utils', () => ({ getMissingRequiredScopes: vi.fn(() => []) }))
vi.mock('@/app/workspace/[workspaceId]/components/connect-oauth-modal', () => ({
  ConnectOAuthModal: (props: unknown) => {
    connectOAuthModalMock(props)
    return null
  },
}))
vi.mock(
  '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/edit-connector-modal',
  () => ({ EditConnectorModal: () => null })
)
vi.mock('@/blocks', () => ({ getBlock: vi.fn(() => undefined) }))
vi.mock('@/blocks/icon-color', () => ({ getTileIconColorClass: vi.fn(() => '') }))
vi.mock('@/connectors/registry', () => ({
  CONNECTOR_META_REGISTRY: {
    slack: {
      id: 'slack',
      name: 'Slack',
      configFields: [],
      auth: { mode: 'oauth', provider: 'slack', requiredScopes: ['channels:read'] },
    },
    confluence: {
      id: 'confluence',
      name: 'Confluence',
      configFields: [{ id: 'domain' }, { id: 'spaceKey' }],
      auth: { mode: 'oauth', provider: 'confluence' },
    },
  },
}))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  isConnectorSyncingOrPending: vi.fn(
    (connector: { status: string }) =>
      connector.status === 'pending' || connector.status === 'syncing'
  ),
  useConnectorDetail: vi.fn(() => ({ data: undefined, isLoading: false })),
  useDeleteConnector: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useTriggerSync: vi.fn(() => ({ mutate: vi.fn() })),
  useUpdateConnector: vi.fn(() => ({ mutate: vi.fn() })),
}))
vi.mock('@/hooks/queries/oauth/oauth-credentials', () => ({
  useOAuthCredentials: vi.fn(() => ({
    data: oauthCredentialsState.current,
    isFetching: oauthCredentialsState.isFetching,
    refetch: vi.fn(),
  })),
}))
vi.mock('@/hooks/use-credential-refresh-triggers', () => ({
  useCredentialRefreshTriggers: credentialRefreshTriggersMock,
}))

import {
  ConnectorsSection,
  SyncHistory,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/connectors-section'
import type { ConnectorData } from '@/hooks/queries/kb/connectors'

let root: Root | null = null

function makeLog(overrides: Partial<SyncLogData> & Pick<SyncLogData, 'status'>): SyncLogData {
  return {
    id: 'log-1',
    connectorId: 'connector-1',
    startedAt: new Date().toISOString(),
    completedAt: null,
    docsAdded: 0,
    docsUpdated: 0,
    docsDeleted: 0,
    docsUnchanged: 0,
    docsSkipped: 0,
    docsFailed: 0,
    errorMessage: null,
    ...overrides,
  }
}

function render(log: SyncLogData) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<SyncHistory logs={[log]} isLoading={false} />))
  return container
}

function makeConnector(overrides: Partial<ConnectorData> = {}): ConnectorData {
  return {
    id: 'connector-1',
    knowledgeBaseId: 'knowledge-1',
    connectorType: 'slack',
    credentialId: 'credential-1',
    sourceConfig: {},
    syncMode: null,
    syncIntervalMinutes: 60,
    status: 'disabled',
    lastSyncAt: null,
    lastSyncError: 'invalid_auth',
    lastSyncDocCount: null,
    nextSyncAt: null,
    consecutiveFailures: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function renderSection(connector: ConnectorData, additionalConnectors: ConnectorData[] = []) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <ConnectorsSection
        workspaceId='workspace-1'
        knowledgeBaseId='knowledge-1'
        connectors={[connector, ...additionalConnectors]}
        isLoading={false}
        canEdit
      />
    )
  )
  return container
}

function icons(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-testid^="icon-"]')).map((node) =>
    node.getAttribute('data-testid')
  )
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  oauthCredentialsState.current = []
  oauthCredentialsState.isFetching = false
  vi.clearAllMocks()
})

describe('Connector credential reauthorization', () => {
  it('distinguishes configured sites and spaces without exposing credential fields', () => {
    const container = renderSection(
      makeConnector({
        connectorType: 'confluence',
        sourceConfig: { domain: 'first.atlassian.net', spaceKey: 'ENG', apiKey: 'private-token' },
      }),
      [
        makeConnector({
          id: 'connector-2',
          connectorType: 'confluence',
          sourceConfig: { domain: 'second.atlassian.net', spaceKey: 'OPS' },
        }),
      ]
    )
    expect(container.textContent).toContain('first.atlassian.net · ENG')
    expect(container.textContent).toContain('second.atlassian.net · OPS')
    expect(container.textContent).not.toContain('private-token')
  })

  it('fails closed when the connector credential cannot be resolved', () => {
    const container = renderSection(makeConnector())
    const reconnectButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Reconnect'
    )

    expect(reconnectButton?.disabled).toBe(true)

    act(() => reconnectButton?.click())

    expect(connectOAuthModalMock).not.toHaveBeenCalled()
  })

  it('reauthorizes with the resolved credential provider and identity', () => {
    oauthCredentialsState.current = [
      { id: 'credential-1', name: 'Workspace Slack', provider: 'slack-custom' },
    ]
    const container = renderSection(makeConnector())
    const reconnectButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Reconnect'
    )

    expect(reconnectButton?.disabled).toBe(false)

    act(() => reconnectButton?.click())

    expect(connectOAuthModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'slack-custom',
        reconnectTarget: {
          workspaceId: 'workspace-1',
          credentialId: 'credential-1',
          displayName: 'Workspace Slack',
        },
      })
    )
    expect(credentialRefreshTriggersMock).toHaveBeenLastCalledWith(
      expect.any(Function),
      'slack-custom',
      { kind: 'workspace', workspaceId: 'workspace-1' }
    )
  })

  it('keeps reauthorization open while the credential query is loading', () => {
    oauthCredentialsState.current = [
      { id: 'credential-1', name: 'Workspace Slack', provider: 'slack-custom' },
    ]
    const connector = makeConnector()
    const container = renderSection(connector)
    const reconnectButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Reconnect'
    )

    act(() => reconnectButton?.click())
    expect(connectOAuthModalMock).toHaveBeenCalledOnce()

    connectOAuthModalMock.mockClear()
    oauthCredentialsState.current = []
    oauthCredentialsState.isFetching = true
    act(() =>
      root?.render(
        <ConnectorsSection
          workspaceId='workspace-1'
          knowledgeBaseId='knowledge-1'
          connectors={[connector]}
          isLoading={false}
          canEdit
        />
      )
    )

    expect(consumeOAuthReturnContextMock).not.toHaveBeenCalled()

    oauthCredentialsState.current = [
      { id: 'credential-1', name: 'Workspace Slack', provider: 'slack-custom' },
    ]
    oauthCredentialsState.isFetching = false
    act(() =>
      root?.render(
        <ConnectorsSection
          workspaceId='workspace-1'
          knowledgeBaseId='knowledge-1'
          connectors={[connector]}
          isLoading={false}
          canEdit
        />
      )
    )

    expect(connectOAuthModalMock).toHaveBeenCalledOnce()
  })

  it('clears the OAuth return context if the credential disappears while open', () => {
    oauthCredentialsState.current = [
      { id: 'credential-1', name: 'Workspace Slack', provider: 'slack-custom' },
    ]
    const connector = makeConnector()
    const container = renderSection(connector)
    const reconnectButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Reconnect'
    )

    act(() => reconnectButton?.click())
    expect(connectOAuthModalMock).toHaveBeenCalledOnce()

    connectOAuthModalMock.mockClear()
    oauthCredentialsState.current = []
    act(() =>
      root?.render(
        <ConnectorsSection
          workspaceId='workspace-1'
          knowledgeBaseId='knowledge-1'
          connectors={[connector]}
          isLoading={false}
          canEdit
        />
      )
    )

    expect(consumeOAuthReturnContextMock).toHaveBeenCalledOnce()
    expect(connectOAuthModalMock).not.toHaveBeenCalled()
  })
})

describe('SyncHistory', () => {
  it('renders a fresh "started" row as in progress, not as a success', () => {
    const container = render(makeLog({ status: 'started' }))

    expect(icons(container)).toEqual(['icon-loader'])
    expect(icons(container)).not.toContain('icon-circle-check')
    expect(container.textContent).toContain('In progress…')
    expect(container.textContent).not.toContain('No changes')
  })

  it('renders a continued listing as partial with the work already completed', () => {
    const container = render(makeLog({ status: 'partial', docsAdded: 3 }))
    expect(icons(container)).toEqual(['icon-triangle-alert'])
    expect(container.textContent).toContain('Partial')
    expect(container.textContent).toContain('+3')
    expect(container.textContent).not.toContain('In progress…')
  })

  it('renders a "completed" row as a success with its change counts', () => {
    const container = render(makeLog({ status: 'completed', docsAdded: 3 }))

    expect(icons(container)).toEqual(['icon-circle-check'])
    expect(container.textContent).toContain('+3')
    expect(container.textContent).not.toContain('In progress…')
  })

  it('renders a "completed" row with no changes as "No changes"', () => {
    const container = render(makeLog({ status: 'completed' }))

    expect(icons(container)).toEqual(['icon-circle-check'])
    expect(container.textContent).toContain('No changes')
  })

  it('renders a skipped-only completed row as a change', () => {
    const container = render(makeLog({ status: 'completed', docsSkipped: 4 }))

    expect(icons(container)).toEqual(['icon-circle-check'])
    expect(container.textContent).toContain('⊘4')
    expect(container.textContent).not.toContain('No changes')
  })

  it('renders mixed sync counts as separate ordered markers', () => {
    const container = render(
      makeLog({
        status: 'completed',
        docsAdded: 2,
        docsUpdated: 3,
        docsDeleted: 4,
        docsFailed: 5,
        docsSkipped: 6,
      })
    )

    expect(container.textContent).toContain('+2 ~3 -4 !5 ⊘6')
    expect(container.textContent).not.toContain('No changes')
  })

  it('renders a "failed" row as an error with its message', () => {
    const container = render(makeLog({ status: 'failed', errorMessage: 'token expired' }))

    expect(icons(container)).toEqual(['icon-circle-x'])
    expect(container.textContent).toContain('token expired')
    expect(container.textContent).not.toContain('No changes')
  })

  describe('stale-lock boundary', () => {
    it('still reads as in progress just inside the stale-lock TTL', () => {
      const startedAt = new Date(
        Date.now() - CONNECTOR_SYNC_STALE_LOCK_TTL_MS + 60_000
      ).toISOString()
      const container = render(makeLog({ status: 'started', startedAt }))

      expect(icons(container)).toEqual(['icon-loader'])
      expect(container.textContent).toContain('In progress…')
      expect(container.textContent).not.toContain('Interrupted')
    })

    it('reads as interrupted once past the stale-lock TTL', () => {
      const startedAt = new Date(
        Date.now() - CONNECTOR_SYNC_STALE_LOCK_TTL_MS - 60_000
      ).toISOString()
      const container = render(makeLog({ status: 'started', startedAt }))

      expect(icons(container)).toEqual(['icon-triangle-alert'])
      expect(container.textContent).toContain('Interrupted')
      expect(container.textContent).not.toContain('In progress…')
      expect(container.textContent).not.toContain('No changes')
    })
  })
})
