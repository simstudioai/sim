/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Credential } from '@/lib/oauth'
import type { ConnectorConfigFieldsProps } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-config-fields/connector-config-fields'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  accountsQuery: vi.fn(),
  configFields: vi.fn(),
  credentials: [] as Pick<Credential, 'id' | 'name' | 'type'>[],
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
vi.mock('@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-scope', () => ({
  useConnectorScope: (
    scope?:
      | { kind: 'workspace'; workspaceId: string }
      | { kind: 'organization'; organizationId: string }
  ) => ({
    scope: scope ?? { kind: 'workspace', workspaceId: 'workspace-1' },
    canAdmin: true,
    memberAccessAvailable: mocks.memberAccess,
    mirroredAccessAvailable: mocks.mirroredAccess,
    hasMaxAccess: true,
  }),
}))
vi.mock('@/hooks/use-member-access', () => ({
  useMemberAccessAvailable: () => mocks.memberAccess,
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({
    integrationAvailability: new Map([
      ['slack', { oauthAvailable: true, state: 'ready' }],
      ['slack_v2', { oauthAvailable: true, state: 'ready' }],
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
      ].map((providerId) => [providerId, true])
    ),
    isIntegrationAvailabilityReady: true,
    isIntegrationAvailabilityLoading: false,
    integrationAvailabilityError: null,
    refetchIntegrationAvailability: vi.fn(),
  }),
}))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  useCreateConnector: () => ({ mutate: mocks.create, isPending: false }),
}))
vi.mock('@/hooks/queries/source-accounts', () => ({
  useSourceAccounts: (scope?: { workspaceId?: string; organizationId?: string }) => {
    mocks.accountsQuery(scope?.organizationId ?? scope?.workspaceId)
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
    data: mocks.credentials,
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
  ConnectorConfigFields: (props: ConnectorConfigFieldsProps) => {
    mocks.configFields(props)
    return null
  },
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
import { googleDriveConnectorMeta } from '@/connectors/google-drive/meta'
import { useConnectorSetupStore } from '@/stores/connector-setup/store'

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
  mocks.credentials = [{ id: 'credential-1', name: 'Source account', type: 'oauth' }]
  useConnectorSetupStore.getState().reset()
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
  it('uses the organization account container and returns to organization setup', async () => {
    await render({ scope: { kind: 'organization', organizationId: 'org-1' } })
    expect(mocks.accountsQuery).toHaveBeenCalledWith('org-1')
    const setup = Array.from(document.querySelectorAll('a')).find(
      (link) => link.textContent?.trim() === 'Set up Slack'
    )
    expect(setup?.getAttribute('href')).toBe(
      '/o/org-1/settings/integrations?search-setup=slack&connectedAccounts=slack'
    )
    expect(document.body.textContent).not.toContain('Create & Invite')
  })
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
  it('keeps organization connected-account setup in members mode', async () => {
    await render({
      scope: { kind: 'organization', organizationId: 'org-1' },
      initialConnectorType: 'confluence',
      initialAccessMode: 'admin',
      membersOnly: true,
    })
    expect(document.body.textContent).not.toContain('Connection method')
    expect(document.body.textContent).not.toContain('Choose another source')
    await act(async () => button('Add source').click())
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorType: 'confluence',
        accessMode: 'members',
      }),
      expect.any(Object)
    )
  })

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

describe('Service-account source fields', () => {
  it.each([
    {
      name: 'connected members with no browsing account',
      browse: null,
      content: null,
      show: false,
    },
    { name: 'connected members browsing with OAuth', browse: 'oauth', content: null, show: false },
    {
      name: 'connected members browsing with a service account',
      browse: 'service',
      content: null,
      show: false,
    },
    {
      name: 'a dedicated OAuth indexing account',
      browse: 'service',
      content: 'oauth',
      show: false,
    },
    {
      name: 'a dedicated service indexing account',
      browse: 'oauth',
      content: 'service',
      show: true,
    },
  ])(
    'only offers an impersonation subject for $name when applicable',
    async ({ browse, content, show }) => {
      mocks.credentials = [
        { id: 'oauth', name: 'Google account', type: 'oauth' },
        { id: 'service', name: 'Indexing account', type: 'service_account' },
      ]
      const setupDraftKey = 'drive-setup'
      useConnectorSetupStore.getState().saveDraft(setupDraftKey, {
        sourceConfig: {},
        canonicalModes: {},
        accessMode: 'members',
        credentialId: browse,
        contentCredentialId: content,
        disabledTagIds: [],
        savedAt: Date.now(),
      })
      await render({
        initialConnectorType: 'google_drive',
        setupDraftKey,
        scope: { kind: 'organization', organizationId: 'org-1' },
      })

      const fields: ConnectorConfigFieldsProps = mocks.configFields.mock.lastCall![0]
      const subjectField = googleDriveConnectorMeta.configFields.find(
        (field) => field.id === 'adminEmail'
      )!
      expect(fields.isFieldVisible(subjectField)).toBe(show)
      expect(
        fields.isFieldVisible(
          googleDriveConnectorMeta.configFields.find((field) => field.id === 'folderSelector')!
        )
      ).toBe(true)
    }
  )

  it.each(['admin', 'workspace'] as const)(
    'keeps the service-account subject available for %s indexing',
    async (accessMode) => {
      mocks.credentials = [{ id: 'service', name: 'Indexing account', type: 'service_account' }]
      await render({
        initialConnectorType: 'google_drive',
        initialAccessMode: accessMode,
        isSearchIndex: accessMode === 'admin',
      })

      const fields: ConnectorConfigFieldsProps = mocks.configFields.mock.lastCall![0]
      expect(
        fields.isFieldVisible(
          googleDriveConnectorMeta.configFields.find((field) => field.id === 'adminEmail')!
        )
      ).toBe(true)
    }
  )
})
