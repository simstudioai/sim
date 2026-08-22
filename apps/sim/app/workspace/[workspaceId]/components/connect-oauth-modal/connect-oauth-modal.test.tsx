/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createDraft: vi.fn(),
  connectOAuthService: vi.fn(),
  onConnect: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  ChipModal: ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? <div>{children}</div> : null,
  ChipModalBody: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ChipModalError: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ChipModalField: ({ title, children }: { title: string; children?: ReactNode }) => (
    <section>
      <span>{title}</span>
      {children}
    </section>
  ),
  ChipModalFooter: ({
    primaryAction,
  }: {
    primaryAction: { label: string; onClick: () => void; disabled: boolean }
  }) => (
    <button
      type='button'
      data-testid='connect'
      onClick={primaryAction.onClick}
      disabled={primaryAction.disabled}
    >
      {primaryAction.label}
    </button>
  ),
  ChipModalHeader: ({ children }: { children?: ReactNode }) => <header>{children}</header>,
  InfoCard: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  InfoCardItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  InfoCardList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { name: 'Test User' } } }),
}))

vi.mock('@/lib/credentials/client-state', () => ({
  ADD_CONNECTOR_SEARCH_PARAM: 'addConnector',
  writeOAuthReturnContext: vi.fn(),
}))

vi.mock('@/lib/credentials/display-name', () => ({
  defaultCredentialDisplayName: () => 'Test credential',
}))

vi.mock('@/lib/oauth', () => ({
  getProviderIdFromServiceId: (serviceId: string) => serviceId,
  OAUTH_PROVIDERS: {
    slack: {
      name: 'Slack',
      icon: null,
      services: {},
    },
  },
  parseProvider: (provider: string) => ({ baseProvider: provider }),
}))

vi.mock('@/lib/oauth/utils', () => ({
  getScopeDescription: (scope: string) => scope,
  getServiceConfigByProviderId: () => null,
}))

vi.mock('@/blocks/brand-icon', () => ({
  withBrandIcon: () => null,
}))

vi.mock('@/hooks/queries/credentials', () => ({
  useCreateCredentialDraft: () => ({
    mutateAsync: mocks.createDraft,
    isPending: false,
  }),
  useWorkspaceCredentials: () => ({
    data: [],
    isPending: false,
  }),
}))

vi.mock('@/hooks/queries/oauth/oauth-connections', () => ({
  useConnectOAuthService: () => ({
    mutateAsync: mocks.connectOAuthService,
    isPending: false,
  }),
}))

import { ConnectOAuthModal } from '@/app/workspace/[workspaceId]/components/connect-oauth-modal/connect-oauth-modal'

let container: HTMLDivElement
let root: Root

function renderReauthorizeModal({
  reconnectTarget,
  onConnect,
}: {
  reconnectTarget?: {
    workspaceId: string
    credentialId: string
    displayName: string
  }
  onConnect?: () => Promise<void> | void
} = {}) {
  act(() => {
    root.render(
      <ConnectOAuthModal
        mode='reauthorize'
        open={true}
        onOpenChange={vi.fn()}
        providerId='slack'
        toolName='Slack'
        reconnectTarget={reconnectTarget}
        onConnect={onConnect}
      />
    )
  })
}

async function clickConnect() {
  const button = container.querySelector<HTMLButtonElement>('[data-testid="connect"]')
  expect(button).not.toBeNull()
  await act(async () => {
    button?.click()
  })
}

describe('ConnectOAuthModal reauthorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createDraft.mockResolvedValue({ success: true, draftId: 'draft-exact' })
    mocks.connectOAuthService.mockResolvedValue({ success: true })
    mocks.onConnect.mockResolvedValue(undefined)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('binds the selected credential draft to the OAuth launch', async () => {
    renderReauthorizeModal({
      reconnectTarget: {
        workspaceId: 'workspace-1',
        credentialId: 'credential-slack',
        displayName: 'Team Slack',
      },
    })

    await clickConnect()

    expect(mocks.createDraft).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      providerId: 'slack',
      credentialId: 'credential-slack',
      displayName: 'Team Slack',
    })
    expect(mocks.connectOAuthService).toHaveBeenCalledWith({
      providerId: 'slack',
      callbackURL: window.location.href,
      draftId: 'draft-exact',
    })
    expect(mocks.createDraft.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.connectOAuthService.mock.invocationCallOrder[0]
    )
  })

  it('does not launch OAuth when the reconnect draft cannot be created', async () => {
    mocks.createDraft.mockRejectedValue(new Error('Draft creation failed'))
    renderReauthorizeModal({
      reconnectTarget: {
        workspaceId: 'workspace-1',
        credentialId: 'credential-slack',
        displayName: 'Team Slack',
      },
    })

    await clickConnect()

    expect(mocks.connectOAuthService).not.toHaveBeenCalled()
    expect(container).toHaveTextContent('Draft creation failed')
  })

  it('preserves provider-only reauthorization without creating a draft', async () => {
    renderReauthorizeModal()

    await clickConnect()

    expect(mocks.createDraft).not.toHaveBeenCalled()
    expect(mocks.connectOAuthService).toHaveBeenCalledWith({
      providerId: 'slack',
      callbackURL: window.location.href,
      draftId: undefined,
    })
  })

  it('keeps an onConnect override ahead of credential-bound reauthorization', async () => {
    renderReauthorizeModal({
      reconnectTarget: {
        workspaceId: 'workspace-1',
        credentialId: 'credential-slack',
        displayName: 'Team Slack',
      },
      onConnect: mocks.onConnect,
    })

    await clickConnect()

    expect(mocks.onConnect).toHaveBeenCalledOnce()
    expect(mocks.createDraft).not.toHaveBeenCalled()
    expect(mocks.connectOAuthService).not.toHaveBeenCalled()
  })
})
