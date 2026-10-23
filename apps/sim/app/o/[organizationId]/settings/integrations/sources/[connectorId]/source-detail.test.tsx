/** @vitest-environment jsdom */

import { act } from 'react'
import {
  kbConnectorsQueriesMock,
  kbConnectorsQueriesMockFns,
} from '@sim/testing/mocks/kb-connectors-queries.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import {
  organizationProviderMock,
  organizationProviderMockFns,
} from '@sim/testing/mocks/organization-provider.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/lib/api/client/errors'
import type { ConnectorData } from '@/lib/api/contracts/knowledge/connectors'
import type { ConnectorActionsOptions } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/use-connector-actions'

const mocks = vi.hoisted(() => ({
  admin: true,
  integrations: vi.fn(),
  actions: vi.fn(),
  form: vi.fn(),
  dirty: false,
  saving: false,
  save: vi.fn(),
}))
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => organizationProviderMock)
vi.mock('@/hooks/use-oauth-return', () => ({ useOAuthReturnForKBConnectors: vi.fn() }))
vi.mock('@/hooks/queries/kb/connectors', () => kbConnectorsQueriesMock)
vi.mock('@/hooks/queries/search-integrations', () => ({
  useSearchIntegrations: mocks.integrations,
}))
vi.mock('@/connectors/registry', () => ({
  CONNECTOR_META_REGISTRY: {
    google_drive: {
      name: 'Google Drive',
      configFields: [],
      searchDocsUrl: 'https://example.com/guide',
    },
  },
}))
vi.mock(
  '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/use-connector-actions',
  () => ({
    useConnectorActions: mocks.actions,
  })
)
vi.mock(
  '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/connector-actions',
  () => ({
    ConnectorActionFeedback: () => null,
  })
)
vi.mock(
  '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/use-connector-settings-form',
  () => ({ useConnectorSettingsForm: mocks.form })
)
vi.mock(
  '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/connector-settings-fields',
  () => ({ ConnectorSettingsFields: () => <p>Source configuration</p> })
)

import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { OrganizationSourceDetail } from '@/app/o/[organizationId]/settings/integrations/sources/[connectorId]/source-detail'

const mockPush = nextNavigationMockFns.router.push
nextNavigationMockFns.mockUsePathname.mockReturnValue(
  '/o/org-one/settings/integrations/sources/source-one'
)
const mockIndex = kbConnectorsQueriesMockFns.mockUseSearchIndex
const mockDetail = kbConnectorsQueriesMockFns.mockUseConnectorDetail
organizationProviderMockFns.mockUseOrganizationContext.mockImplementation(() => ({
  organization: { id: 'org-one' },
  viewer: { isAdmin: mocks.admin },
}))

const connector: ConnectorData = {
  id: 'source-one',
  knowledgeBaseId: 'index-one',
  connectorType: 'google_drive',
  credentialId: null,
  sourceConfig: {},
  syncMode: null,
  syncIntervalMinutes: 5,
  status: 'active',
  lastSyncAt: null,
  lastSyncError: null,
  lastSyncDocCount: null,
  nextSyncAt: null,
  consecutiveFailures: 0,
  accessMode: 'admin',
  viewerMembership: null,
  credentialGroupId: null,
  credentialGroupOptionId: null,
  memberSyncStatus: 'idle',
  lastMemberSyncAt: null,
  nextMemberSyncAt: null,
  lastMemberSyncError: null,
  memberSyncConsecutiveFailures: 0,
  accessRewritePending: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('organization source detail navigation', () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.admin = true
    mocks.dirty = false
    mocks.saving = false
    mockIndex.mockReturnValue({ data: { knowledgeBaseId: 'index-one' }, isPending: false })
    mockDetail.mockReturnValue({ data: connector })
    mocks.integrations.mockReturnValue({
      data: [{ connectorType: 'google_drive', approved: true }],
    })
    mocks.actions.mockImplementation((options: ConnectorActionsOptions) => ({
      actions: [
        {
          id: 'sync',
          text: 'Sync now',
          variant: options.primarySync ? 'primary' : undefined,
          disabled: options.disabled,
          onSelect: vi.fn(),
        },
        { id: 'pause', text: 'Pause syncing', disabled: options.disabled, onSelect: vi.fn() },
        { id: 'delete', text: 'Remove connection', disabled: options.disabled, onSelect: vi.fn() },
      ],
    }))
    mocks.form.mockImplementation(() => ({
      dirty: mocks.dirty,
      saving: mocks.saving,
      canSave: mocks.dirty && !mocks.saving,
      save: mocks.save,
      fieldsProps: {},
      displayName: 'Google Drive',
    }))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })
  async function render() {
    await act(async () =>
      root.render(
        <SettingsHeaderProvider>
          <SettingsHeaderShell>
            <OrganizationSourceDetail connectorId='source-one' />
          </SettingsHeaderShell>
        </SettingsHeaderProvider>
      )
    )
  }
  async function click(text: string) {
    const button = Array.from(document.querySelectorAll('button')).find(
      (item) => item.textContent?.trim() === text
    )
    expect(button, `Missing ${text}`).toBeTruthy()
    await act(async () => button!.click())
  }

  it('does not load protected source data for non-admins', async () => {
    mocks.admin = false
    await render()
    expect(mockIndex).toHaveBeenLastCalledWith(
      { kind: 'organization', organizationId: 'org-one' },
      { enabled: false }
    )
    expect(mockDetail).toHaveBeenLastCalledWith(undefined, 'source-one')
    expect(mocks.actions).not.toHaveBeenCalled()
    expect(mocks.integrations).not.toHaveBeenCalled()
  })

  it('hides cached source data after access is revoked, even if the index also failed', async () => {
    await render()
    mockIndex.mockReturnValue({
      data: { knowledgeBaseId: 'index-one' },
      isError: true,
      error: new Error('Temporary failure'),
      refetch: vi.fn(),
    })
    mockDetail.mockReturnValue({
      data: connector,
      isError: true,
      error: new ApiClientError({ status: 403, message: 'Access denied', body: null }),
      refetch: vi.fn(),
    })
    await render()
    expect(container.textContent).toContain('Access denied')
    expect(container.textContent).not.toContain('Source configuration')
  })

  it('hides cached source settings when integration status reports revoked access', async () => {
    await render()
    mocks.integrations.mockReturnValue({
      data: [{ connectorType: 'google_drive', approved: true }],
      isError: true,
      error: new ApiClientError({ status: 403, message: 'Access denied', body: null }),
      refetch: vi.fn(),
    })
    await render()
    expect(container.textContent).toContain('Access denied')
    expect(container.textContent).not.toContain('Source configuration')
  })

  it('preserves the editable baseline across background connector updates', async () => {
    await render()
    mockDetail.mockReturnValue({
      data: { ...connector, status: 'syncing', sourceConfig: { folderId: 'changed-remotely' } },
    })
    await render()
    expect(mocks.form).toHaveBeenLastCalledWith(expect.objectContaining({ connector }))
  })

  it('uses the canonical saved row as the new settings baseline without leaving the source', async () => {
    mocks.dirty = true
    await render()
    await click('Save')
    expect(mocks.save).toHaveBeenCalledOnce()

    const saved = { ...connector, sourceConfig: { folderId: 'saved-folder' } }
    await act(async () => mocks.form.mock.calls.at(-1)![0].onSaved(saved))
    expect(mocks.form).toHaveBeenLastCalledWith(expect.objectContaining({ connector: saved }))
    expect(mockPush).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Source configuration')

    mockDetail.mockReturnValue({ data: { ...connector, status: 'syncing' } })
    await render()
    expect(mocks.form).toHaveBeenLastCalledWith(expect.objectContaining({ connector: saved }))
  })

  it('discards to the latest server settings only when explicitly requested', async () => {
    mocks.dirty = true
    await render()
    const refreshed = { ...connector, sourceConfig: { folderId: 'latest-server-folder' } }
    mockDetail.mockReturnValue({ data: refreshed })
    await render()
    expect(mocks.form).toHaveBeenLastCalledWith(expect.objectContaining({ connector }))

    await click('Discard')
    expect(mocks.form).toHaveBeenLastCalledWith(expect.objectContaining({ connector: refreshed }))
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Source configuration')
  })
})
