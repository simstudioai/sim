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
import type { ConnectorSettingsFieldsProps } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/connector-settings-fields'
import type { ConnectorMeta } from '@/connectors/types'

const mocks = vi.hoisted(() => ({
  credentials: [] as Pick<Credential, 'id' | 'name' | 'provider' | 'type'>[],
  serviceAccountModal: vi.fn(),
  serviceAccountTarget: vi.fn(),
  selectCredential: vi.fn(),
}))

vi.mock('@/hooks/queries/oauth/oauth-credentials', () => ({
  useOAuthCredentials: () => ({
    data: mocks.credentials,
    isLoading: false,
    refetch: vi.fn(),
  }),
}))
vi.mock('@/hooks/use-credential-refresh-triggers', () => ({
  useCredentialRefreshTriggers: vi.fn(),
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
  ConnectorConfigFields: () => null,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access-field',
  () => ({
    ConnectorAccessField: () => null,
    ConnectorContentCredentialField: () => null,
  })
)

import { ConnectorSettingsFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/connector-settings-fields'
import { confluenceConnectorMeta } from '@/connectors/confluence/meta'
import { googleDriveConnectorMeta } from '@/connectors/google-drive/meta'

function fieldProps(connectorConfig: ConnectorMeta): ConnectorSettingsFieldsProps {
  return {
    availability: { error: null, isFetching: false, refetch: vi.fn() },
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
