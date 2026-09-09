/**
 * @vitest-environment jsdom
 */
import type { ButtonHTMLAttributes, ReactNode, SVGProps } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SyncLogData } from '@/lib/api/contracts/knowledge/connectors'
import {
  CONNECTOR_SYNC_STALE_LOCK_TTL_MS,
  MEMBER_SYNC_STALE_LOCK_TTL_MS,
} from '@/lib/knowledge/connectors/sync-limits'

const {
  consumeOAuthReturnContextMock,
  connectOAuthModalMock,
  credentialRefreshTriggersMock,
  icon,
  oauthCredentialsState,
  lifecycle,
  missingScopesMock,
} = vi.hoisted(() => ({
  consumeOAuthReturnContextMock: vi.fn(),
  connectOAuthModalMock: vi.fn(),
  credentialRefreshTriggersMock: vi.fn(),
  icon: (name: string) => (props: SVGProps<SVGSVGElement>) => (
    <svg data-testid={`icon-${name}`} className={props.className} />
  ),
  oauthCredentialsState: {
    current: [] as Array<{
      id: string
      name: string
      provider: string
      type?: 'oauth' | 'service_account'
    }>,
    isFetching: false,
  },
  lifecycle: {
    sync: { mutate: vi.fn(), reset: vi.fn(), error: null as Error | null, isPending: false },
    update: { mutate: vi.fn(), reset: vi.fn(), error: null as Error | null, isPending: false },
    remove: { mutate: vi.fn(), reset: vi.fn(), error: null as Error | null, isPending: false },
    detail: {
      current: undefined as unknown,
      isError: false,
      isPlaceholderData: false,
      refetch: vi.fn(),
    },
  },
  missingScopesMock: vi.fn(() => [] as string[]),
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
  Users: icon('users'),
  MoreHorizontal: icon('more-horizontal'),
  ArrowRight: icon('arrow-right'),
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
  Checkbox: ({
    id,
    checked,
    disabled,
    onCheckedChange,
  }: {
    id: string
    checked: boolean
    disabled?: boolean
    onCheckedChange: (checked: boolean) => void
  }) => (
    <input
      id={id}
      type='checkbox'
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
  ChipConfirmModal: ({
    open,
    title,
    children,
    confirm,
    onOpenChange,
  }: {
    open: boolean
    title: string
    children: ReactNode
    confirm: { label: string; onClick: () => void; pending?: boolean; disabled?: boolean }
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div role='dialog' aria-label={title}>
        {children}
        <button
          type='button'
          onClick={confirm.onClick}
          disabled={confirm.pending || confirm.disabled}
        >
          {confirm.label}
        </button>
        <button type='button' onClick={() => onOpenChange(false)}>
          Cancel
        </button>
      </div>
    ) : null,
  ChipModalField: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalError: ({ children }: { children: ReactNode }) =>
    children ? <div role='alert'>{children}</div> : null,
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  DropdownMenu: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children?: ReactNode
    disabled?: boolean
    onSelect: () => void
  }) => (
    <button type='button' disabled={disabled} onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
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
  getProviderIdFromServiceId: vi.fn((serviceId: string) =>
    serviceId === 'google-drive' ? 'google-drive' : 'slack'
  ),
}))
vi.mock('@/lib/oauth/utils', () => ({ getMissingRequiredScopes: missingScopesMock }))
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
      rehydrateOnFullSync: true,
    },
    confluence: {
      id: 'confluence',
      name: 'Confluence',
      configFields: [{ id: 'domain' }, { id: 'spaceKey' }],
      auth: { mode: 'oauth', provider: 'confluence' },
    },
    google_drive: {
      id: 'google_drive',
      name: 'Google Drive',
      configFields: [],
      auth: {
        mode: 'oauth',
        provider: 'google-drive',
        adminCredentialType: 'service_account',
      },
    },
  },
}))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  isConnectorSyncingOrPending: vi.fn(
    (connector: { status: string; memberSyncStatus?: string }) =>
      connector.status === 'pending' ||
      connector.status === 'syncing' ||
      connector.memberSyncStatus === 'pending' ||
      connector.memberSyncStatus === 'running'
  ),
  useConnectorDetail: vi.fn(() => ({
    data: lifecycle.detail.current,
    isLoading: false,
    isError: lifecycle.detail.isError,
    isPlaceholderData: lifecycle.detail.isPlaceholderData,
    refetch: lifecycle.detail.refetch,
  })),
  useDeleteConnector: () => lifecycle.remove,
  useTriggerSync: () => lifecycle.sync,
  useUpdateConnector: () => lifecycle.update,
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
  ConnectorActions,
  ConnectorRecovery,
  ConnectorSyncHistory,
  ConnectorsSection,
  SyncHistory,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section'
import { type ConnectorData, useConnectorDetail } from '@/hooks/queries/kb/connectors'

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
    accessMode: 'admin',
    memberSyncStatus: 'idle',
    viewerMembership: null,
    credentialGroupId: null,
    credentialGroupOptionId: null,
    lastMemberSyncAt: null,
    nextMemberSyncAt: null,
    lastMemberSyncError: null,
    memberSyncConsecutiveFailures: 0,
    accessRewritePending: false,
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

function renderComponent(component: ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(component))
  return container
}

function findButton(container: ParentNode, label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent === label || item.getAttribute('aria-label') === label
  )
  if (!button) throw new Error(`Missing ${label} button`)
  return button
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  oauthCredentialsState.current = []
  oauthCredentialsState.isFetching = false
  for (const mutation of [lifecycle.sync, lifecycle.update, lifecycle.remove]) {
    mutation.isPending = false
    mutation.error = null
    mutation.mutate.mockReset()
  }
  lifecycle.detail.current = undefined
  lifecycle.detail.isError = false
  lifecycle.detail.isPlaceholderData = false
  missingScopesMock.mockReturnValue([])
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

    expect(consumeOAuthReturnContextMock).not.toHaveBeenCalled()
    expect(connectOAuthModalMock).not.toHaveBeenCalled()
  })

  it('preserves pending OAuth return context when the recovery modal closes', () => {
    oauthCredentialsState.current = [
      { id: 'credential-1', name: 'Workspace Slack', provider: 'slack-custom' },
    ]
    const container = renderSection(makeConnector())
    act(() => findButton(container, 'Reconnect').click())
    act(() => connectOAuthModalMock.mock.calls.at(-1)?.[0].onOpenChange(false))
    expect(consumeOAuthReturnContextMock).not.toHaveBeenCalled()
  })

  it('returns an organization reconnect to its source detail page', () => {
    oauthCredentialsState.current = [
      { id: 'credential-1', name: 'Workspace Slack', provider: 'slack-custom' },
    ]
    const container = renderComponent(
      <ConnectorRecovery
        connector={makeConnector()}
        knowledgeBaseId='knowledge-1'
        scope={{ kind: 'organization', organizationId: 'organization-1' }}
        canEdit
        isSearchIndex
      />
    )
    act(() => findButton(container, 'Reconnect').click())
    expect(connectOAuthModalMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reconnectTarget: {
          organizationId: 'organization-1',
          credentialId: 'credential-1',
          displayName: 'Workspace Slack',
        },
        returnContext: {
          origin: 'kb-connectors',
          knowledgeBaseId: 'knowledge-1',
          connectorId: 'connector-1',
          connectorType: 'slack',
        },
      })
    )
  })

  it('reuses the source return context when connecting a missing account', () => {
    const container = renderComponent(
      <ConnectorRecovery
        connector={makeConnector({ credentialId: null })}
        knowledgeBaseId='knowledge-1'
        scope={{ kind: 'organization', organizationId: 'organization-1' }}
        canEdit
      />
    )
    act(() => findButton(container, 'Reconnect').click())
    expect(connectOAuthModalMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'connect',
        connectorType: 'slack',
        organizationId: 'organization-1',
        knowledgeBaseId: 'knowledge-1',
        connectorId: 'connector-1',
      })
    )
  })

  it('cannot reconnect away from unsaved source settings', () => {
    oauthCredentialsState.current = [
      { id: 'credential-1', name: 'Workspace Slack', provider: 'slack-custom' },
    ]
    const container = renderComponent(
      <ConnectorRecovery
        connector={makeConnector()}
        knowledgeBaseId='knowledge-1'
        scope={{ kind: 'organization', organizationId: 'organization-1' }}
        canEdit
        disabled
      />
    )
    expect(findButton(container, 'Reconnect').disabled).toBe(true)
    act(() => findButton(container, 'Reconnect').click())
    expect(connectOAuthModalMock).not.toHaveBeenCalled()
  })

  it('reauthorizes missing scopes on an otherwise active source', () => {
    oauthCredentialsState.current = [
      { id: 'credential-1', name: 'Workspace Slack', provider: 'slack-custom' },
    ]
    missingScopesMock.mockReturnValue(['channels:read'])
    const container = renderSection(makeConnector({ status: 'active' }))
    act(() => findButton(container, 'Update access').click())
    expect(connectOAuthModalMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'reauthorize', newScopes: ['channels:read'] })
    )
  })

  it.each(['present', 'unavailable', 'deleted'] as const)(
    'opens source settings for a disabled administrator Drive source with a %s service account',
    (credentialState) => {
      const onEdit = vi.fn()
      oauthCredentialsState.current =
        credentialState === 'present'
          ? [
              {
                id: 'service-1',
                name: 'Drive service account',
                provider: 'google-drive',
                type: 'service_account',
              },
            ]
          : []
      const container = renderComponent(
        <ConnectorRecovery
          connector={makeConnector({
            connectorType: 'google_drive',
            credentialId: credentialState === 'deleted' ? null : 'service-1',
          })}
          knowledgeBaseId='knowledge-1'
          scope={{ kind: 'organization', organizationId: 'organization-1' }}
          canEdit
          isSearchIndex
          onEdit={onEdit}
        />
      )

      expect(findButton(container, 'Settings')).toBeEnabled()
      act(() => findButton(container, 'Settings').click())
      expect(onEdit).toHaveBeenCalledOnce()
      expect(connectOAuthModalMock).not.toHaveBeenCalled()
    }
  )

  it('also routes a general-KB service account to settings instead of OAuth', () => {
    const onEdit = vi.fn()
    oauthCredentialsState.current = [
      {
        id: 'service-1',
        name: 'Drive service account',
        provider: 'google-drive',
        type: 'service_account',
      },
    ]
    const container = renderComponent(
      <ConnectorRecovery
        connector={makeConnector({
          connectorType: 'google_drive',
          credentialId: 'service-1',
          accessMode: 'workspace',
        })}
        knowledgeBaseId='knowledge-1'
        scope={{ kind: 'workspace', workspaceId: 'workspace-1' }}
        canEdit
        onEdit={onEdit}
      />
    )

    act(() => findButton(container, 'Settings').click())
    expect(onEdit).toHaveBeenCalledOnce()
    expect(connectOAuthModalMock).not.toHaveBeenCalled()
  })

  it.each([
    { canEdit: false, disabled: false },
    { canEdit: true, disabled: true },
  ])('protects service-account recovery when %o', ({ canEdit, disabled }) => {
    const onEdit = vi.fn()
    const container = renderComponent(
      <ConnectorRecovery
        connector={makeConnector({ connectorType: 'google_drive', credentialId: null })}
        knowledgeBaseId='knowledge-1'
        scope={{ kind: 'organization', organizationId: 'organization-1' }}
        canEdit={canEdit}
        disabled={disabled}
        onEdit={onEdit}
      />
    )
    if (canEdit) {
      expect(findButton(container, 'Settings')).toBeDisabled()
      act(() => findButton(container, 'Settings').click())
    } else {
      expect(container.querySelector('button')).toBeNull()
    }
    expect(onEdit).not.toHaveBeenCalled()
    expect(connectOAuthModalMock).not.toHaveBeenCalled()
  })

  it('closes OAuth across account-type changes until the user explicitly reconnects', () => {
    const onEdit = vi.fn()
    const connector = makeConnector({ connectorType: 'google_drive', accessMode: 'workspace' })
    const credential = { id: 'credential-1', name: 'Drive account', provider: 'google-drive' }
    oauthCredentialsState.current = [{ ...credential, type: 'oauth' }]
    const renderRecovery = () => (
      <ConnectorRecovery
        connector={connector}
        knowledgeBaseId='knowledge-1'
        scope={{ kind: 'workspace', workspaceId: 'workspace-1' }}
        canEdit
        onEdit={onEdit}
      />
    )
    const container = renderComponent(renderRecovery())
    act(() => findButton(container, 'Reconnect').click())
    expect(connectOAuthModalMock).toHaveBeenCalledOnce()

    connectOAuthModalMock.mockClear()
    oauthCredentialsState.current = [{ ...credential, type: 'service_account' }]
    act(() => root?.render(renderRecovery()))
    expect(connectOAuthModalMock).not.toHaveBeenCalled()
    expect(findButton(container, 'Settings')).toBeEnabled()

    oauthCredentialsState.current = [{ ...credential, type: 'oauth' }]
    act(() => root?.render(renderRecovery()))
    expect(connectOAuthModalMock).not.toHaveBeenCalled()
    expect(findButton(container, 'Reconnect')).toBeEnabled()
    act(() => findButton(container, 'Reconnect').click())
    expect(connectOAuthModalMock).toHaveBeenCalledOnce()
    expect(onEdit).not.toHaveBeenCalled()
  })
})

describe('shared connector lifecycle actions', () => {
  it('distinguishes an incremental sync from a supported full resync', () => {
    const container = renderComponent(
      <ConnectorActions
        connector={makeConnector({ status: 'active' })}
        knowledgeBaseId='knowledge-1'
        canEdit
      />
    )
    act(() => findButton(container, 'Sync now').click())
    expect(lifecycle.sync.mutate).toHaveBeenLastCalledWith({
      knowledgeBaseId: 'knowledge-1',
      connectorId: 'connector-1',
      rehydrate: false,
    })
    act(() => findButton(container, 'Full resync').click())
    expect(lifecycle.sync.mutate).toHaveBeenLastCalledWith({
      knowledgeBaseId: 'knowledge-1',
      connectorId: 'connector-1',
      rehydrate: true,
    })
  })

  it.each(['pending', 'running', 'disabled'] as const)(
    'does not offer content resync or dispatch work while the member engine is %s',
    (memberSyncStatus) => {
      const container = renderComponent(
        <ConnectorActions
          connector={makeConnector({ status: 'active', accessMode: 'members', memberSyncStatus })}
          knowledgeBaseId='knowledge-1'
          canEdit
        />
      )
      expect(container.textContent).not.toContain('Full resync')
      const syncButton = container.querySelector('button')!
      expect(syncButton.disabled).toBe(true)
      act(() => syncButton.click())
      expect(lifecycle.sync.mutate).not.toHaveBeenCalled()
    }
  )

  it('resumes a paused source and prevents reversing its optimistic update before settling', () => {
    const connector = makeConnector({ status: 'paused' })
    const container = renderComponent(
      <ConnectorActions connector={connector} knowledgeBaseId='knowledge-1' canEdit />
    )
    expect(findButton(container, 'Sync now').disabled).toBe(true)
    act(() => findButton(container, 'Resume').click())
    expect(lifecycle.update.mutate).toHaveBeenCalledWith({
      knowledgeBaseId: 'knowledge-1',
      connectorId: 'connector-1',
      updates: { status: 'active' },
    })
    lifecycle.update.isPending = true
    act(() =>
      root?.render(
        <ConnectorActions
          connector={{ ...connector, status: 'active' }}
          knowledgeBaseId='knowledge-1'
          canEdit
        />
      )
    )
    expect(findButton(container, 'Pause').disabled).toBe(true)
    act(() => findButton(container, 'Pause').click())
    expect(lifecycle.update.mutate).toHaveBeenCalledOnce()
  })

  it.each([true, false])('removes member documents automatically: %s', (members) => {
    const onRemoved = vi.fn()
    const container = renderComponent(
      <ConnectorActions
        connector={makeConnector({
          status: 'active',
          accessMode: members ? 'members' : 'admin',
        })}
        knowledgeBaseId='knowledge-1'
        onRemoved={onRemoved}
        canEdit
      />
    )
    act(() => findButton(container, 'Remove').click())
    const dialog = container.querySelector('[role="dialog"]')!
    expect(Boolean(dialog.querySelector('input'))).toBe(!members)
    act(() => findButton(dialog, 'Remove').click())
    expect(lifecycle.remove.mutate).toHaveBeenCalledWith(
      { knowledgeBaseId: 'knowledge-1', connectorId: 'connector-1', deleteDocuments: members },
      expect.any(Object)
    )
    act(() => lifecycle.remove.mutate.mock.calls[0][1].onSuccess())
    expect(onRemoved).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('can explicitly delete content-mode documents and retains a failed removal for retry', () => {
    const connector = makeConnector({ status: 'active' })
    const container = renderComponent(
      <ConnectorActions connector={connector} knowledgeBaseId='knowledge-1' canEdit />
    )
    act(() => findButton(container, 'Remove').click())
    const dialog = container.querySelector('[role="dialog"]')!
    act(() => dialog.querySelector<HTMLInputElement>('input')!.click())
    act(() => findButton(dialog, 'Remove').click())
    expect(lifecycle.remove.mutate.mock.calls[0][0].deleteDocuments).toBe(true)
    lifecycle.remove.error = new Error('Removal failed')
    act(() =>
      root?.render(<ConnectorActions connector={connector} knowledgeBaseId='knowledge-1' canEdit />)
    )
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Removal failed')
  })

  it('keeps lifecycle actions unavailable while the source settings are being edited', () => {
    const container = renderComponent(
      <ConnectorActions
        connector={makeConnector({ status: 'active' })}
        knowledgeBaseId='knowledge-1'
        canEdit
        disabled
      />
    )
    expect(findButton(container, 'Sync now').disabled).toBe(true)
    expect(findButton(container, 'Source actions').disabled).toBe(true)
    expect(findButton(container, 'Pause').disabled).toBe(true)
    expect(findButton(container, 'Remove').disabled).toBe(true)
  })

  it('does not expose mutation controls to a viewer', () => {
    const container = renderComponent(
      <ConnectorActions connector={makeConnector()} knowledgeBaseId='knowledge-1' canEdit={false} />
    )
    expect(container.querySelector('button')).toBeNull()
  })
})

describe('shared connector sync history', () => {
  it('reuses the detail page query instead of starting another polling observer', () => {
    const connector = makeConnector()
    const detail = {
      ...connector,
      syncLogs: [makeLog({ status: 'completed', docsAdded: 3 })],
      memberSyncLogs: [],
      members: { active: 0, suspended: 0, stale: 0 },
    }
    const container = renderComponent(
      <ConnectorSyncHistory connector={connector} knowledgeBaseId='knowledge-1' detail={detail} />
    )
    expect(useConnectorDetail).toHaveBeenLastCalledWith(undefined, undefined)
    expect(container.textContent).toContain('3 added')
  })

  it('does not display the previous source history while a new source loads', () => {
    lifecycle.detail.isPlaceholderData = true
    lifecycle.detail.current = { syncLogs: [makeLog({ status: 'completed', docsAdded: 999 })] }
    const container = renderComponent(
      <ConnectorSyncHistory connector={makeConnector()} knowledgeBaseId='knowledge-1' />
    )
    expect(container.textContent).toContain('Loading sync history…')
    expect(container.textContent).not.toContain('999')
  })

  it.each(['partial', 'failed', 'started'] as const)(
    'preserves member history counts, failures and interrupted runs: %s',
    (status) => {
      lifecycle.detail.current = {
        memberSyncLogs: [
          {
            id: 'member-log-1',
            status,
            startedAt: new Date(Date.now() - MEMBER_SYNC_STALE_LOCK_TTL_MS - 60_000).toISOString(),
            membersCompleted: 1,
            membersIncomplete: 1,
            membersFailed: 1,
            docsAdded: 2,
            docsUpdated: 0,
            docsTombstoned: 1,
            docsPurged: 2,
            errorMessage: 'The member account needs reconnecting',
          },
        ],
      }
      const container = renderComponent(
        <ConnectorSyncHistory
          connector={makeConnector({ accessMode: 'members' })}
          knowledgeBaseId='knowledge-1'
        />
      )
      if (status === 'partial') {
        expect(container.textContent).toContain('Partial')
        expect(container.textContent).toContain('3 members · 1 failed · 2 added · 3 deleted')
      } else if (status === 'failed') {
        expect(container.textContent).toContain('The member account needs reconnecting')
      } else {
        expect(container.textContent).toContain('Interrupted')
        expect(container.textContent).not.toContain('In progress…')
      }
    }
  )

  it('loads the member engine history rather than the content history', () => {
    lifecycle.detail.current = {
      syncLogs: [makeLog({ status: 'completed', docsAdded: 999 })],
      memberSyncLogs: [],
      members: { active: 2, suspended: 1, stale: 0 },
    }
    const container = renderComponent(
      <ConnectorSyncHistory
        connector={makeConnector({ accessMode: 'members' })}
        knowledgeBaseId='knowledge-1'
      />
    )
    expect(container.textContent).toContain('2 connected')
    expect(container.textContent).toContain('1 need reconnecting')
    expect(container.textContent).toContain('No member sync history yet.')
    expect(container.textContent).not.toContain('999')
  })

  it('offers retry on a failed history load instead of claiming the history is empty', () => {
    lifecycle.detail.isError = true
    const container = renderComponent(
      <ConnectorSyncHistory connector={makeConnector()} knowledgeBaseId='knowledge-1' />
    )
    expect(container.textContent).toContain('Could not load sync history')
    expect(container.textContent).not.toContain('No sync history yet.')
    act(() => findButton(container, 'Try again').click())
    expect(lifecycle.detail.refetch).toHaveBeenCalledOnce()
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
    expect(container.textContent).toContain('3 added')
    expect(container.textContent).not.toContain('In progress…')
  })

  it('renders a "completed" row as a success with its change counts', () => {
    const container = render(makeLog({ status: 'completed', docsAdded: 3 }))

    expect(icons(container)).toEqual(['icon-circle-check'])
    expect(container.textContent).toContain('3 added')
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
    expect(container.textContent).toContain('4 skipped')
    expect(container.textContent).not.toContain('No changes')
  })

  it('renders mixed sync counts with readable labels', () => {
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

    expect(container.textContent).toContain(
      '2 added · 3 updated · 4 deleted · 5 failed · 6 skipped'
    )
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
