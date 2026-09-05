/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  accountsQuery: vi.fn(),
  memberAccess: true,
  mirroredAccess: true,
  accountState: 'missing' as
    | 'missing'
    | 'loading'
    | 'error'
    | 'inactive'
    | 'unconfigured'
    | 'ready',
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
  usePathname: () => '/workspace/workspace-1/search',
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useWorkspaceHostContext: () => ({
    ownerBilling: {},
    features: { knowledgeSourceMirroredAccess: mocks.mirroredAccess },
  }),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({ canAdmin: true }),
}))
vi.mock('@/hooks/use-member-access', () => ({
  useMemberAccessAvailable: () => mocks.memberAccess,
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({ integrationAvailability: new Map() }),
}))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  useCreateConnector: () => ({ mutate: mocks.create, isPending: false }),
}))
vi.mock('@/hooks/queries/credential-groups', () => ({
  useWorkspaceAccounts: (workspaceId?: string) => {
    mocks.accountsQuery(workspaceId)
    return {
      data:
        mocks.accountState === 'loading' || mocks.accountState === 'error'
          ? undefined
          : {
              credentialGroup:
                mocks.accountState === 'missing'
                  ? null
                  : {
                      status: mocks.accountState === 'inactive' ? 'inactive' : 'active',
                      options: [
                        {
                          provider: 'slack',
                          status: 'active',
                          configurationStatus:
                            mocks.accountState === 'unconfigured' ? 'missing' : 'ready',
                        },
                      ],
                    },
            },
      isLoading: mocks.accountState === 'loading',
      isPending: mocks.accountState === 'loading',
      isSuccess: mocks.accountState !== 'loading' && mocks.accountState !== 'error',
      isError: mocks.accountState === 'error',
      isFetching: mocks.accountState === 'loading',
      refetch: vi.fn(),
      error: mocks.accountState === 'error' ? new Error('Could not load accounts') : null,
    }
  },
}))
vi.mock('@/hooks/queries/oauth/oauth-credentials', () => ({
  useOAuthCredentials: () => ({
    data: [{ id: 'credential-1', name: 'Source account' }],
    isLoading: false,
    refetch: vi.fn(),
  }),
}))
vi.mock('@/hooks/use-oauth-return', () => ({ useOAuthReturnForKBConnectors: vi.fn() }))
vi.mock('@/hooks/use-credential-refresh-triggers', () => ({
  useCredentialRefreshTriggers: vi.fn(),
}))
vi.mock('@/app/workspace/[workspaceId]/components/connect-oauth-modal', () => ({
  ConnectOAuthModal: () => null,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal',
  () => ({
    ConnectServiceAccountModal: () => null,
    useServiceAccountConnectTarget: () => null,
  })
)
vi.mock('@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-config-fields', () => ({
  ConnectorConfigFields: () => null,
}))
vi.mock('@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields', () => ({
  useConnectorConfigFields: () => ({
    sourceConfig: {},
    setSourceConfig: vi.fn(),
    canonicalModes: {},
    setCanonicalModes: vi.fn(),
    canonicalGroups: [],
    isFieldVisible: () => true,
    isFieldPopulated: () => true,
    handleFieldChange: vi.fn(),
    toggleCanonicalMode: vi.fn(),
    resolveSourceConfig: () => ({}),
  }),
}))

import { AddConnectorModal } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/add-connector-modal/add-connector-modal'

let root: Root
let container: HTMLDivElement

async function render(props: Partial<ComponentProps<typeof AddConnectorModal>> = {}) {
  await act(async () => {
    root.render(
      <AddConnectorModal
        open
        onOpenChange={vi.fn()}
        knowledgeBaseId='kb-search'
        isSearchIndex
        initialConnectorType='slack'
        initialAccessMode='members'
        {...props}
      />
    )
  })
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll('button')).find(
    (node) => node.textContent?.trim() === label
  )
  if (!match) throw new Error(`Missing button: ${label}`)
  return match
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.memberAccess = true
  mocks.mirroredAccess = true
  mocks.accountState = 'missing'
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('Slack member setup readiness', () => {
  it.each(['missing', 'loading', 'error', 'inactive', 'unconfigured'] as const)(
    'refuses creation while workspace Slack setup is %s',
    async (state) => {
      mocks.accountState = state
      await render()
      expect(document.body.textContent).not.toContain('Create & Invite')
      expect(document.body.textContent).toContain('Connection method')
      expect(document.body.textContent).not.toContain('Browse with')
      expect(document.body.textContent).not.toContain('Sync documents with')
      expect(document.body.textContent).not.toContain('Document details (optional)')
      expect(button('Cancel')).toBeEnabled()
      expect(mocks.create).not.toHaveBeenCalled()
      expect(mocks.accountsQuery).toHaveBeenCalledWith('workspace-1')
      if (state === 'error') {
        expect(document.body.textContent).toContain('Could not load accounts')
        expect(button('Try again')).toBeEnabled()
        expect(document.body.textContent).not.toContain('Set up Slack')
      }
    }
  )

  it.each([true, false])(
    'allows member creation once Slack is ready (Search: %s)',
    async (isSearchIndex) => {
      mocks.accountState = 'ready'
      await render({ isSearchIndex })
      expect(document.body.textContent).toContain('Browse with')
      expect(document.body.textContent).toContain('Sync documents with')
      expect(document.body.textContent).toContain('Document details (optional)')
      expect(button('Create & Invite')).toBeEnabled()
      await act(async () => button('Create & Invite').click())
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ connectorType: 'slack', accessMode: 'members' }),
        expect.any(Object)
      )
    }
  )

  it('also blocks unconfigured Slack members in a general knowledge base', async () => {
    await render({ isSearchIndex: false })
    expect(document.body.textContent).not.toContain('Create & Invite')
    expect(document.body.textContent).toContain('Set up Slack')
  })

  it('reveals the configuration once Slack setup becomes ready', async () => {
    await render()
    expect(document.body.textContent).toContain('Set up Slack')
    expect(document.body.textContent).not.toContain('Browse with')
    mocks.accountState = 'ready'
    await render()
    expect(document.body.textContent).not.toContain('Set up Slack')
    expect(document.body.textContent).toContain('Browse with')
    expect(button('Create & Invite')).toBeEnabled()
  })

  it('does not require Slack setup for a workspace-mode connection', async () => {
    await render({ isSearchIndex: false, initialAccessMode: 'workspace' })
    expect(button('Connect & Sync')).toBeEnabled()
    expect(mocks.accountsQuery).not.toHaveBeenCalledWith('workspace-1')
  })
})

describe('Search methods requiring member identity', () => {
  it('blocks a new Confluence admin connection when member identity is unavailable', async () => {
    mocks.memberAccess = false
    await render({ initialConnectorType: 'confluence', initialAccessMode: 'admin' })
    expect(button('Connect & Sync')).toBeDisabled()
    expect(document.querySelector('[role="radiogroup"]')).toBeNull()
    await act(async () => button('Connect & Sync').click())
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('allows Confluence central syncing once both feature gates are available', async () => {
    await render({ initialConnectorType: 'confluence', initialAccessMode: 'admin' })
    expect(button('Connect & Sync')).toBeEnabled()
    await act(async () => button('Connect & Sync').click())
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ connectorType: 'confluence', accessMode: 'admin' }),
      expect.any(Object)
    )
    expect(mocks.accountsQuery).not.toHaveBeenCalledWith('workspace-1')
  })

  it('also requires member identity for Confluence admin mode in general knowledge bases', async () => {
    mocks.memberAccess = false
    await render({
      isSearchIndex: false,
      initialConnectorType: 'confluence',
      initialAccessMode: 'admin',
    })
    expect(button('Connect & Sync')).toBeDisabled()
    expect(button('Admin or service account')).toBeDisabled()
    expect(button('Workspace')).toBeEnabled()
  })
})
