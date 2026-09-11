/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Credential } from '@/lib/oauth'
import type {
  ConnectServiceAccountModal,
  ServiceAccountConnectTarget,
  useServiceAccountConnectTarget,
} from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal'
import {
  ConnectorConfigFields as ActualConnectorConfigFields,
  type ConnectorConfigFieldsProps,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-config-fields/connector-config-fields'
import type { ConnectorSettingsFieldsProps } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/connector-settings-fields'
import type { ConnectorMeta } from '@/connectors/types'

const mocks = vi.hoisted(() => ({
  credentials: [] as Pick<Credential, 'id' | 'name' | 'provider' | 'type'>[],
  serviceAccountModal: vi.fn(),
  serviceAccountTarget: vi.fn(),
  selectCredential: vi.fn(),
  credentialOptions: vi.fn(),
  configFields: vi.fn(),
  renderConfigFields: false,
  selectorOptions: vi.fn(),
  accessField: vi.fn(),
  contentField: vi.fn(),
  installationModal: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useParams: () => ({}) }))
vi.mock('@/hooks/use-debounce', () => ({ useDebounce: (value: string) => value }))
vi.mock('@/hooks/queries/selectors', () => ({
  useSelectorOptions: (...args: unknown[]) => {
    mocks.selectorOptions(...args)
    return { data: [], error: null, truncated: false }
  },
  useSelectorOptionDetails: () => ({ data: [] }),
  useSelectorOptionDetail: () => ({}),
}))

vi.mock('@/hooks/queries/oauth/oauth-credentials', () => ({
  useOAuthCredentials: (...args: unknown[]) => {
    mocks.credentialOptions(...args)
    return {
      data: mocks.credentials,
      isLoading: false,
      refetch: vi.fn(),
    }
  },
}))
vi.mock('@/hooks/use-credential-refresh-triggers', () => ({
  useCredentialRefreshTriggers: vi.fn(),
}))
vi.mock('@/app/workspace/[workspaceId]/search/components/github-installation-modal', () => ({
  GitHubInstallationModal: (props: { onConnected: (credentialId: string) => void }) => {
    mocks.installationModal(props)
    return (
      <button type='button' onClick={() => props.onConnected('replacement-installation')}>
        Finish GitHub connection
      </button>
    )
  },
}))
vi.mock(
  '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal',
  () => ({
    useServiceAccountConnectTarget: (
      args: Parameters<typeof useServiceAccountConnectTarget>[0]
    ): ServiceAccountConnectTarget | null => {
      mocks.serviceAccountTarget(args)
      if (!args.serviceAccountProviderId || !args.serviceName || !args.serviceIcon) return null
      return {
        serviceAccountProviderId: args.serviceAccountProviderId,
        serviceName: args.serviceName,
        serviceIcon: args.serviceIcon,
        label: 'Add service account',
        hidden: false,
      }
    },
    ConnectServiceAccountModal: (props: ComponentProps<typeof ConnectServiceAccountModal>) => {
      mocks.serviceAccountModal(props)
      return props.open ? (
        <button type='button' onClick={() => props.onCreated?.('new-service-account')}>
          Finish service account setup
        </button>
      ) : null
    },
  })
)
vi.mock('@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-config-fields', () => ({
  ConnectorConfigFields: (props: ConnectorConfigFieldsProps) => {
    mocks.configFields(props)
    return mocks.renderConfigFields ? <ActualConnectorConfigFields {...props} /> : null
  },
}))
vi.mock(
  '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access-field',
  () => ({
    ConnectorAccessField: (props: unknown) => {
      mocks.accessField(props)
      return null
    },
    ConnectorContentCredentialField: (props: unknown) => {
      mocks.contentField(props)
      return null
    },
  })
)

import { ConnectorSettingsFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/connector-settings-fields'
import { confluenceConnectorMeta } from '@/connectors/confluence/meta'
import { githubConnectorMeta } from '@/connectors/github/meta'
import { googleDriveConnectorMeta } from '@/connectors/google-drive/meta'

function fieldProps(connectorConfig: ConnectorMeta): ConnectorSettingsFieldsProps {
  return {
    availability: { error: null, isFetching: false, isReady: true, refetch: vi.fn() },
    isSearchIndex: true,
    connectorConfig,
    selectionLabels: {},
    sourceConfig: {},
    credentialId: null,
    canonicalGroups: new Map(),
    canonicalModes: {},
    onToggleCanonicalMode: vi.fn(),
    onFieldChange: vi.fn(),
    isFieldVisible: () => false,
    syncInterval: 60,
    setSyncInterval: vi.fn(),
    hasMaxAccess: true,
    isSaving: false,
    error: null,
    access: { accessMode: 'admin' },
    onAccessChange: vi.fn(),
    canAdmin: true,
    showAccessField: true,
    allowMembers: true,
    allowAdmin: true,
    allowWorkspace: false,
    canReenableMemberSync: false,
    accessDirty: true,
    accessModeChanged: true,
    accessComplete: false,
    isSwitchingAccess: false,
    onApplyAccess: vi.fn(),
    onResetAccess: vi.fn(),
    scope: { kind: 'organization', organizationId: 'org-1' },
    needsWorkspaceCredential: true,
    workspaceCredentialId: null,
    contentCredentialId: null,
    onContentCredentialChange: vi.fn(),
    onWorkspaceCredentialChange: mocks.selectCredential,
  }
}

describe('connector settings service-account choices', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.credentials = []
    mocks.renderConfigFields = false
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(
    meta: ConnectorMeta,
    overrides: Partial<ConnectorSettingsFieldsProps> = {}
  ) {
    await act(async () => {
      root.render(<ConnectorSettingsFields {...fieldProps(meta)} {...overrides} />)
    })
  }

  async function openAccountChoices() {
    const dropdown = container.querySelector<HTMLElement>('[role="combobox"]')
    if (!dropdown) throw new Error('Missing indexing-account selector')
    await act(async () => dropdown.click())
  }

  async function choose(label: string) {
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (node) => node.textContent?.trim() === label
    )
    if (!option) throw new Error(`Missing account choice: ${label}`)
    await act(async () => {
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
  }

  const installationProps = (): Partial<ConnectorSettingsFieldsProps> => ({
    usesGitHubInstallation: true,
    access: { accessMode: 'members' },
    credentialId: 'installation-1',
    contentCredentialId: 'installation-1',
    sourceConfig: { repository: 'acme/platform' },
    needsWorkspaceCredential: false,
    accessDirty: false,
    accessModeChanged: false,
    accessComplete: true,
    isFieldVisible: () => true,
  })

  it('shows the GitHub connection and preserves the repository rename field for installation sources', async () => {
    mocks.credentials = [
      {
        id: 'installation-1',
        name: 'acme',
        provider: 'github-app-installation',
        type: 'service_account',
      },
    ]
    await render(githubConnectorMeta, installationProps())
    expect(container.textContent).toContain('GitHub')
    expect(container.textContent).toContain('acme')
    expect(mocks.contentField).not.toHaveBeenCalled()
    expect(mocks.accessField).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('Account for browsing')
    expect(mocks.configFields).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorConfig: githubConnectorMeta,
        sourceConfig: { repository: 'acme/platform' },
      })
    )
  })

  it('rotates only among GitHub installation connections through the existing access operation', async () => {
    mocks.credentials = [
      {
        id: 'installation-1',
        name: 'acme',
        provider: 'github-app-installation',
        type: 'service_account',
      },
      {
        id: 'installation-2',
        name: 'acme-backup',
        provider: 'github-app-installation',
        type: 'service_account',
      },
      { id: 'legacy-reader', name: 'Personal GitHub', provider: 'github', type: 'oauth' },
    ]
    const change = vi.fn()
    const apply = vi.fn()
    const reset = vi.fn()
    const changeAccess = vi.fn()
    await render(githubConnectorMeta, { ...installationProps(), onContentCredentialChange: change })
    await openAccountChoices()
    expect(document.body.textContent).not.toContain('Personal GitHub')
    await choose('acme-backup')
    expect(change).toHaveBeenCalledWith('installation-2')
    await render(githubConnectorMeta, {
      ...installationProps(),
      contentCredentialId: 'installation-2',
      accessDirty: true,
      onApplyAccess: apply,
      onResetAccess: reset,
      onAccessChange: changeAccess,
    })
    const applyButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Change connection'
    )!
    await act(async () => applyButton.click())
    expect(apply).toHaveBeenCalledOnce()
    expect(changeAccess).not.toHaveBeenCalled()
    const cancel = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Cancel'
    )!
    await act(async () => cancel.click())
    expect(reset).toHaveBeenCalledOnce()
  })

  it('offers GitHub recovery when the saved installation is unavailable', async () => {
    const change = vi.fn()
    await render(githubConnectorMeta, { ...installationProps(), onContentCredentialChange: change })
    const connect = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Connect GitHub'
    )!
    await act(async () => connect.click())
    expect(mocks.installationModal).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1' })
    )
    const finish = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Finish GitHub connection'
    )!
    await act(async () => finish.click())
    expect(change).toHaveBeenCalledWith('replacement-installation')
    expect(mocks.accessField).not.toHaveBeenCalled()
    expect(mocks.contentField).not.toHaveBeenCalled()
  })

  it('keeps the existing re-enable operation available without exposing access modes', async () => {
    const apply = vi.fn()
    await render(githubConnectorMeta, {
      ...installationProps(),
      canReenableMemberSync: true,
      onApplyAccess: apply,
    })
    const reenable = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Re-enable sync'
    )!
    await act(async () => reenable.click())
    expect(apply).toHaveBeenCalledOnce()
    expect(mocks.accessField).not.toHaveBeenCalled()
  })

  it.each([
    { isSearchIndex: false },
    { scope: { kind: 'workspace' as const, workspaceId: 'workspace-1' } },
  ])(
    'keeps general knowledge-base and workspace settings on their original path: %j',
    async (overrides) => {
      await render(githubConnectorMeta, { ...installationProps(), ...overrides })
      expect(mocks.contentField).toHaveBeenCalled()
      expect(mocks.accessField).toHaveBeenCalled()
      expect(mocks.configFields).toHaveBeenCalledWith(
        expect.objectContaining({ connectorConfig: githubConnectorMeta })
      )
    }
  )

  it.each([true, false])(
    'locks the sync method only for Search settings (%s)',
    async (isSearchIndex) => {
      await render(confluenceConnectorMeta, { isSearchIndex })
      expect(mocks.accessField).toHaveBeenLastCalledWith(
        expect.objectContaining({ lockAccessMode: isSearchIndex })
      )
    }
  )

  it.each([null, 'dedicated-github-account'])(
    'preserves legacy GitHub member source settings with content account %s',
    async (contentCredentialId) => {
      await render(githubConnectorMeta, {
        access: { accessMode: 'members' },
        contentCredentialId,
        sourceConfig: { repository: 'team/docs' },
        needsWorkspaceCredential: false,
        isFieldVisible: () => true,
      })
      expect(mocks.contentField).toHaveBeenLastCalledWith(
        expect.objectContaining({ credentialId: contentCredentialId })
      )
      expect(mocks.configFields).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceConfig: { repository: 'team/docs' },
          connectorConfig: githubConnectorMeta,
        })
      )
      expect(document.body.textContent).not.toContain('Connect GitHub')
    }
  )

  it('keeps a failed availability check actionable before methods are known', async () => {
    const refetch = vi.fn()
    await render(confluenceConnectorMeta, {
      availability: {
        error: new Error('Could not load connection availability'),
        isFetching: false,
        isReady: false,
        refetch,
      },
      allowAdmin: false,
    })
    expect(container.textContent).toContain('Could not load connection availability')
    expect(mocks.accessField).toHaveBeenLastCalledWith(
      expect.objectContaining({ isAvailabilityReady: false, allowAdmin: false })
    )
    const retry = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Try again'
    )
    expect(retry).toBeEnabled()
    await act(async () => retry!.click())
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('shows the acting user’s managed connection for browsing member sources', async () => {
    mocks.credentials = [
      { id: 'managed-1', name: 'My Confluence', provider: 'confluence', type: 'managed_oauth' },
    ]
    await render(confluenceConnectorMeta, {
      access: { accessMode: 'members' },
      needsWorkspaceCredential: false,
      isFieldVisible: () => true,
    })
    expect(mocks.credentialOptions).toHaveBeenCalledWith(
      'confluence',
      expect.objectContaining({ organizationId: 'org-1', purpose: 'browsing' })
    )
    await openAccountChoices()
    await choose('My Confluence')
    expect(mocks.configFields).toHaveBeenLastCalledWith(
      expect.objectContaining({ credentialId: 'managed-1' })
    )
    expect(mocks.selectCredential).not.toHaveBeenCalled()
  })

  it('never offers a managed connection for central indexing', async () => {
    mocks.credentials = [
      { id: 'managed-1', name: 'My Confluence', provider: 'confluence', type: 'managed_oauth' },
    ]
    await render(confluenceConnectorMeta)
    expect(mocks.credentialOptions).toHaveBeenCalledWith(
      'confluence',
      expect.objectContaining({ purpose: undefined })
    )
    await openAccountChoices()
    expect(document.body.textContent).not.toContain('My Confluence')
  })

  it.each(['managed_oauth', 'oauth', 'service_account'] as const)(
    'uses the %s browsing identity independently of a delegated Drive content account',
    async (type) => {
      mocks.renderConfigFields = true
      mocks.credentials = [
        { id: 'browsing-account', name: 'Browse Drive', provider: 'google-drive', type },
        {
          id: 'indexing-account',
          name: 'Content indexing',
          provider: 'google-drive',
          type: 'service_account',
        },
      ]
      await render(googleDriveConnectorMeta, {
        access: { accessMode: 'members' },
        contentCredentialId: 'indexing-account',
        sourceConfig: { adminEmail: 'crawl-admin@example.com' },
        needsWorkspaceCredential: false,
        isFieldVisible: (field) => field.id === 'folderSelector',
      })
      await openAccountChoices()
      await choose('Browse Drive')

      expect(mocks.selectorOptions).toHaveBeenLastCalledWith(
        'google.drive',
        expect.objectContaining({
          enabled: true,
          scope: { kind: 'organization', organizationId: 'org-1' },
          context: {
            oauthCredential: 'browsing-account',
            mimeType: 'application/vnd.google-apps.folder',
            ...(type === 'service_account'
              ? { impersonateUserEmail: 'crawl-admin@example.com' }
              : {}),
          },
        })
      )
      expect(mocks.selectCredential).not.toHaveBeenCalled()
    }
  )

  it('waits for the selected account metadata before browsing a saved delegated source', async () => {
    mocks.renderConfigFields = true
    const overrides: Partial<ConnectorSettingsFieldsProps> = {
      credentialId: 'indexing-account',
      sourceConfig: { adminEmail: 'crawl-admin@example.com' },
      isFieldVisible: (field) => field.id === 'folderSelector',
    }
    await render(googleDriveConnectorMeta, overrides)
    expect(mocks.selectorOptions).toHaveBeenLastCalledWith(
      'google.drive',
      expect.objectContaining({ enabled: false })
    )

    mocks.credentials = [
      {
        id: 'indexing-account',
        name: 'Content indexing',
        provider: 'google-drive',
        type: 'service_account',
      },
    ]
    await render(googleDriveConnectorMeta, overrides)
    expect(mocks.selectorOptions).toHaveBeenLastCalledWith(
      'google.drive',
      expect.objectContaining({
        enabled: true,
        context: {
          oauthCredential: 'indexing-account',
          mimeType: 'application/vnd.google-apps.folder',
          impersonateUserEmail: 'crawl-admin@example.com',
        },
      })
    )
  })

  it.each([
    {
      meta: confluenceConnectorMeta,
      provider: 'atlassian-service-account',
      product: 'confluence',
    },
    { meta: googleDriveConnectorMeta, provider: 'google-service-account', product: undefined },
  ])(
    'opens the correct $meta.name service-account setup from Search settings',
    async ({ meta, provider, product }) => {
      await render(meta)
      expect(mocks.serviceAccountTarget).toHaveBeenLastCalledWith(
        expect.objectContaining({ serviceAccountProviderId: provider })
      )
      await openAccountChoices()
      await choose('Add service account')
      expect(mocks.serviceAccountModal).toHaveBeenLastCalledWith(
        expect.objectContaining({
          open: true,
          organizationId: 'org-1',
          serviceAccountProviderId: provider,
          atlassianProduct: product,
          atlassianSetupGuideUrl:
            product === 'confluence'
              ? 'https://docs.sim.ai/search/confluence#using-a-service-account'
              : undefined,
        })
      )

      const finish = Array.from(container.querySelectorAll('button')).find(
        (node) => node.textContent === 'Finish service account setup'
      )
      if (!finish) throw new Error('Missing service-account completion control')
      await act(async () => finish.click())
      expect(mocks.selectCredential).toHaveBeenCalledExactlyOnceWith('new-service-account')
    }
  )

  it('keeps an existing Google service account selectable without opening new setup', async () => {
    mocks.credentials = [
      {
        id: 'google-service-account-1',
        name: 'Search indexing account',
        provider: 'google-drive',
        type: 'service_account',
      },
    ]
    await render(googleDriveConnectorMeta)
    await openAccountChoices()
    await choose('Search indexing account')
    expect(mocks.selectCredential).toHaveBeenCalledExactlyOnceWith('google-service-account-1')
    expect(mocks.serviceAccountModal).not.toHaveBeenCalled()
  })

  it('only offers service accounts when replacing a central Confluence credential', async () => {
    mocks.credentials = [
      { id: 'personal', name: 'Personal Confluence', provider: 'confluence', type: 'oauth' },
      {
        id: 'service',
        name: 'Confluence indexing',
        provider: 'atlassian-service-account',
        type: 'service_account',
      },
    ]
    await render(confluenceConnectorMeta)
    expect(container.textContent).toContain('Service account')
    await openAccountChoices()
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).map((node) =>
        node.textContent?.trim()
      )
    ).toEqual(['Confluence indexing', 'Add service account'])
    await choose('Confluence indexing')
    expect(mocks.selectCredential).toHaveBeenCalledExactlyOnceWith('service')
  })

  it('preserves the regular knowledge-base Confluence account choices', async () => {
    mocks.credentials = [
      {
        id: 'confluence-1',
        name: 'Existing Confluence account',
        provider: 'confluence',
        type: 'oauth',
      },
    ]
    await render(confluenceConnectorMeta, {
      isSearchIndex: false,
      access: { accessMode: 'workspace' },
      allowWorkspace: true,
      scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    })
    expect(mocks.serviceAccountTarget).toHaveBeenLastCalledWith(
      expect.objectContaining({ serviceAccountProviderId: undefined })
    )
    await openAccountChoices()
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).map((node) =>
        node.textContent?.trim()
      )
    ).toEqual(['Existing Confluence account'])
    await choose('Existing Confluence account')
    expect(mocks.selectCredential).toHaveBeenCalledExactlyOnceWith('confluence-1')
    expect(mocks.serviceAccountModal).not.toHaveBeenCalled()
  })
})
