/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createDraft: vi.fn(),
  connectOAuthService: vi.fn(),
  getServiceConfigByProviderId: vi.fn(),
  onConnect: vi.fn(),
  clearOAuthReturnContext: vi.fn(),
  workspaceCredentials: vi.fn(),
  writeOAuthReturnContext: vi.fn(),
}))

interface MockChipModalFieldProps {
  children?: ReactNode
  inputType?: string
  onChange?: (value: string) => void
  options?: Array<{ label: string; value: string }>
  title: string
  type?: string
  value?: string
}

vi.mock('@sim/emcn', () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  ChipModal: ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? <div>{children}</div> : null,
  ChipModalBody: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ChipModalError: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ChipModalField: ({
    title,
    children,
    inputType,
    onChange,
    options,
    type,
    value,
  }: MockChipModalFieldProps) => (
    <section>
      <span>{title}</span>
      {type === 'input' && (
        <input
          aria-label={title}
          type={inputType}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
        />
      )}
      {type === 'dropdown' && (
        <select
          aria-label={title}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
        >
          {options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      {type === 'copy' && <output>{value}</output>}
      {children}
    </section>
  ),
  ChipModalFooter: ({
    primaryAction,
    secondaryActions,
  }: {
    primaryAction: { label: string; onClick: () => void; disabled: boolean }
    secondaryActions?: { label: string; onClick: () => void }[]
  }) => (
    <>
      {secondaryActions?.map((action) => (
        <button key={action.label} type='button' onClick={action.onClick}>
          {action.label}
        </button>
      ))}
      <button
        type='button'
        data-testid='connect'
        onClick={primaryAction.onClick}
        disabled={primaryAction.disabled}
      >
        {primaryAction.label}
      </button>
    </>
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
  clearOAuthReturnContext: mocks.clearOAuthReturnContext,
  writeOAuthReturnContext: mocks.writeOAuthReturnContext,
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
  getServiceConfigByProviderId: mocks.getServiceConfigByProviderId,
}))

vi.mock('@/blocks/brand-icon', () => ({
  withBrandIcon: () => null,
}))

vi.mock('@/hooks/queries/credentials', () => ({
  useCreateCredentialDraft: () => ({
    mutateAsync: mocks.createDraft,
    isPending: false,
  }),
}))

vi.mock('@/hooks/queries/scoped-credentials', () => ({
  useScopedCredentials: mocks.workspaceCredentials,
}))

vi.mock('@/hooks/queries/oauth/oauth-connections', () => ({
  useConnectOAuthService: () => ({
    mutateAsync: mocks.connectOAuthService,
    isPending: false,
  }),
}))

vi.mock('@/hooks/queries/oauth/microsoft-dataverse-connections', () => ({
  useConnectMicrosoftDataverseOAuthService: () => ({
    mutateAsync: vi.fn(),
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

function setFormControlValue(control: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype =
    control instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  valueSetter?.call(control, value)
  control.dispatchEvent(
    new Event(control instanceof HTMLSelectElement ? 'change' : 'input', {
      bubbles: true,
    })
  )
}

describe('ConnectOAuthModal reauthorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createDraft.mockResolvedValue({
      success: true,
      draftId: 'draft-exact',
    })
    mocks.connectOAuthService.mockResolvedValue({ success: true })
    mocks.onConnect.mockResolvedValue(undefined)
    mocks.getServiceConfigByProviderId.mockReturnValue(null)
    mocks.workspaceCredentials.mockReturnValue({ data: [], isPending: false })
    window.history.replaceState({}, '', '/')
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('opens an optional setup guide without submitting or losing the connection name', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const onOpenChange = vi.fn()
    act(() => {
      root.render(
        <ConnectOAuthModal
          mode='connect'
          origin='kb-connectors'
          open
          onOpenChange={onOpenChange}
          providerId='slack'
          workspaceId='workspace-1'
          knowledgeBaseId='kb-search'
          requiredScopes={[]}
          docsUrl='https://docs.sim.ai/search/slack'
        />
      )
    })
    const name = container.querySelector<HTMLInputElement>('input[aria-label="Display name"]')!
    expect(name).not.toBeNull()
    act(() => setFormControlValue(name, 'Team account'))
    const guide = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Setup guide'
    )!

    act(() => guide.click())

    expect(open).toHaveBeenCalledWith(
      'https://docs.sim.ai/search/slack',
      '_blank',
      'noopener,noreferrer'
    )
    expect(name.value).toBe('Team account')
    expect(mocks.createDraft).not.toHaveBeenCalled()
    expect(mocks.connectOAuthService).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    await clickConnect()
    expect(mocks.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Team account', providerId: 'slack' })
    )
  })

  it('does not add a setup action without a contextual guide', () => {
    renderReauthorizeModal()
    expect(container.textContent).not.toContain('Setup guide')
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
    expect(mocks.writeOAuthReturnContext).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'integrations',
        displayName: 'Team Slack',
        providerId: 'slack',
        workspaceId: 'workspace-1',
        reconnect: true,
      })
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
    expect(mocks.clearOAuthReturnContext).not.toHaveBeenCalled()
  })

  it('clears reconnect context when the provider handoff cannot start', async () => {
    mocks.connectOAuthService.mockRejectedValue(new Error('Provider launch failed'))
    renderReauthorizeModal({
      reconnectTarget: {
        workspaceId: 'workspace-1',
        credentialId: 'credential-slack',
        displayName: 'Team Slack',
      },
    })

    await clickConnect()

    expect(mocks.writeOAuthReturnContext).toHaveBeenCalledOnce()
    expect(mocks.clearOAuthReturnContext).toHaveBeenCalledOnce()
    expect(container).toHaveTextContent('Provider launch failed')
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

  it('does not carry a prior OAuth result into a new provider callback URL', async () => {
    window.history.replaceState(
      {},
      '',
      '/?keep=1&error=stale&error_description=stale-detail&quickbooks_connected=true'
    )
    renderReauthorizeModal()

    await clickConnect()

    expect(mocks.connectOAuthService).toHaveBeenCalledWith({
      providerId: 'slack',
      callbackURL: 'http://localhost:3000/?keep=1',
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

  it('collects QuickBooks app credentials inside the standard OAuth connection flow', async () => {
    const onOpenChange = vi.fn()
    mocks.getServiceConfigByProviderId.mockReturnValue({
      clientConfiguration: {
        redirectPath: '/api/auth/oauth2/callback/quickbooks',
        fields: [
          { id: 'clientId', label: 'Client ID', type: 'text' },
          {
            id: 'clientSecret',
            label: 'Client secret',
            type: 'secret',
            secret: true,
          },
          {
            id: 'webhookVerifierToken',
            label: 'Webhook verifier token',
            type: 'secret',
            secret: true,
          },
          {
            id: 'environment',
            label: 'Environment',
            type: 'select',
            options: [
              { label: 'Sandbox', value: 'sandbox' },
              { label: 'Production', value: 'production' },
            ],
          },
        ],
      },
    })

    act(() => {
      root.render(
        <ConnectOAuthModal
          mode='connect'
          open={true}
          onOpenChange={onOpenChange}
          providerId='quickbooks'
          workspaceId='workspace-1'
          requiredScopes={[]}
          origin='integrations'
        />
      )
    })

    const clientId = container.querySelector<HTMLInputElement>('input[aria-label="Client ID"]')
    const clientSecret = container.querySelector<HTMLInputElement>(
      'input[aria-label="Client secret"]'
    )
    const environment = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Environment"]'
    )
    const webhookVerifierToken = container.querySelector<HTMLInputElement>(
      'input[aria-label="Webhook verifier token"]'
    )
    expect(clientSecret?.type).toBe('password')
    expect(webhookVerifierToken?.type).toBe('password')
    expect(container).toHaveTextContent('http://localhost:3000/api/auth/oauth2/callback/quickbooks')

    act(() => {
      if (clientId) {
        setFormControlValue(clientId, 'client-id')
      }
      if (clientSecret) {
        setFormControlValue(clientSecret, 'client-secret')
      }
      if (environment) {
        setFormControlValue(environment, 'production')
      }
      if (webhookVerifierToken) {
        setFormControlValue(webhookVerifierToken, 'verifier-token')
      }
    })

    await clickConnect()

    expect(mocks.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        providerId: 'quickbooks',
        oauthClientConfig: {
          clientId: 'client-id',
          clientSecret: 'client-secret',
          environment: 'production',
          webhookVerifierToken: 'verifier-token',
        },
      })
    )
    expect(mocks.writeOAuthReturnContext).toHaveBeenCalledOnce()
    expect(mocks.clearOAuthReturnContext).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mocks.writeOAuthReturnContext.mock.invocationCallOrder[0]).toBeLessThan(
      onOpenChange.mock.invocationCallOrder[0]
    )
  })
})
