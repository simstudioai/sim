/** @vitest-environment jsdom */
import { act } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/lib/api/client/errors'
import type { ConnectorData } from '@/lib/api/contracts/knowledge/connectors'
import type { ConnectorActionsOptions } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/use-connector-actions'

const mocks = vi.hoisted(() => ({
  admin: true,
  index: vi.fn(),
  detail: vi.fn(),
  push: vi.fn(),
  documents: vi.fn(),
  actions: vi.fn(),
  history: vi.fn(),
  form: vi.fn(),
  dirty: false,
  save: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => '/o/org-one/settings/integrations/sources/source-one',
}))
vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOrganizationContext: () => ({
    organization: { id: 'org-one' },
    viewer: { isAdmin: mocks.admin },
  }),
}))
vi.mock('@/hooks/use-oauth-return', () => ({ useOAuthReturnForKBConnectors: vi.fn() }))
vi.mock('@/hooks/queries/kb/connectors', () => ({
  useSearchIndex: mocks.index,
  useConnectorDetail: mocks.detail,
  isConnectorSyncingOrPending: () => false,
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
  '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-documents/connector-documents',
  () => ({
    ConnectorDocuments: (props: unknown) => {
      mocks.documents(props)
      return <p>Source documents</p>
    },
  })
)
vi.mock('@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section', () => ({
  ConnectorRecovery: () => null,
  ConnectorSyncHistory: () => {
    mocks.history()
    return <p>Source sync history</p>
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
    vi.clearAllMocks()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.admin = true
    mocks.dirty = false
    mocks.index.mockReturnValue({ data: { knowledgeBaseId: 'index-one' }, isPending: false })
    mocks.detail.mockReturnValue({ data: connector })
    mocks.actions.mockImplementation((options: ConnectorActionsOptions) => ({
      actions: [
        {
          id: 'sync',
          text: 'Sync now',
          variant: options.primarySync ? 'primary' : undefined,
          disabled: options.disabled,
          onSelect: vi.fn(),
        },
        { id: 'pause', text: 'Pause', disabled: options.disabled, onSelect: vi.fn() },
        { id: 'delete', text: 'Remove', disabled: options.disabled, onSelect: vi.fn() },
      ],
    }))
    mocks.form.mockImplementation(() => ({
      dirty: mocks.dirty,
      saving: false,
      canSave: mocks.dirty,
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
    vi.unstubAllGlobals()
  })
  async function render(searchParams = '') {
    await act(async () =>
      root.render(
        <NuqsTestingAdapter hasMemory searchParams={searchParams}>
          <SettingsHeaderProvider>
            <SettingsHeaderShell>
              <OrganizationSourceDetail connectorId='source-one' />
            </SettingsHeaderShell>
          </SettingsHeaderProvider>
        </NuqsTestingAdapter>
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
  it('opens documents by default and uses the exact canonical search index', async () => {
    await render()
    expect(mocks.detail).toHaveBeenLastCalledWith('index-one', 'source-one')
    expect(mocks.documents).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: 'index-one',
        connectorId: 'source-one',
        filter: 'active',
      })
    )
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await click('Sync history')
    expect(mocks.history).toHaveBeenCalled()
    await click('Integrations')
    expect(mocks.push).toHaveBeenCalledWith('/o/org-one/settings/integrations')
  })
  it('restores document search and status from the shared URL', async () => {
    await render('?search=notes&document-filter=excluded')
    expect(mocks.documents).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'notes', filter: 'excluded' })
    )
    expect(mocks.documents).toHaveBeenLastCalledWith(
      expect.objectContaining({ searchControl: { value: 'notes', onChange: expect.any(Function) } })
    )
  })

  it.each([
    { ...connector, id: 'another-source' },
    { ...connector, knowledgeBaseId: 'another-index' },
  ])('never exposes actions for a stale detail placeholder', async (data) => {
    mocks.detail.mockReturnValue({ data })
    await render()
    expect(mocks.actions).not.toHaveBeenCalled()
    expect(mocks.documents).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Loading source')
  })
  it('does not load protected source data for non-admins', async () => {
    mocks.admin = false
    await render()
    expect(mocks.index).toHaveBeenLastCalledWith(
      { kind: 'organization', organizationId: 'org-one' },
      { enabled: false }
    )
    expect(mocks.detail).toHaveBeenLastCalledWith(undefined, 'source-one')
    expect(mocks.actions).not.toHaveBeenCalled()
  })
  it('shows a missing source when there is no search index', async () => {
    mocks.index.mockReturnValue({ data: { knowledgeBaseId: null }, isPending: false })
    mocks.detail.mockReturnValue({})
    await render()
    expect(container.textContent).toContain('This source is no longer available')
    expect(mocks.actions).not.toHaveBeenCalled()
  })
  it('requires discard confirmation before leaving dirty settings', async () => {
    mocks.dirty = true
    await render('?view=settings')
    expect(mocks.actions).toHaveBeenLastCalledWith(
      expect.objectContaining({ disabled: true, primarySync: false })
    )
    for (const label of ['Sync now', 'Pause', 'Remove']) {
      const action = Array.from(container.querySelectorAll('button')).find(
        (item) => item.textContent === label
      )
      expect(action).toBeDisabled()
    }
    await click('Documents')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Unsaved Changes')
    expect(mocks.documents).not.toHaveBeenCalled()
    await click('Keep editing')
    await click('Integrations')
    expect(mocks.push).not.toHaveBeenCalled()
    await click('Discard Changes')
    expect(mocks.push).toHaveBeenCalledWith('/o/org-one/settings/integrations')
  })

  it('places source actions in the resource header before the view tabs', async () => {
    await render()
    const sync = Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent === 'Sync now'
    )
    const tabs = container.querySelector('[aria-label="Source views"]')
    expect(sync).toBeTruthy()
    expect(tabs).toBeTruthy()
    expect(sync!.compareDocumentPosition(tabs!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(mocks.actions).toHaveBeenLastCalledWith(expect.objectContaining({ primarySync: true }))
  })
  it.each(['index', 'detail'] as const)(
    'preserves a dirty draft when a background %s refresh fails',
    async (query) => {
      await render('?view=settings')
      mocks.dirty = true
      const data =
        query === 'index'
          ? { knowledgeBaseId: 'index-one' }
          : { ...connector, sourceConfig: { folderId: 'new-server-value' } }
      mocks[query].mockReturnValue({
        data,
        isError: true,
        error: new Error('Temporary refresh failure'),
        refetch: vi.fn(),
      })
      await render('?view=settings')
      expect(container.textContent).toContain('Temporary refresh failure')
      expect(mocks.form).toHaveBeenLastCalledWith(expect.objectContaining({ connector }))
      await click('Documents')
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Unsaved Changes')
    }
  )

  it('hides cached source data after access is revoked, even if the index also failed', async () => {
    await render('?view=settings')
    mocks.index.mockReturnValue({
      data: { knowledgeBaseId: 'index-one' },
      isError: true,
      error: new Error('Temporary failure'),
      refetch: vi.fn(),
    })
    mocks.detail.mockReturnValue({
      data: connector,
      isError: true,
      error: new ApiClientError({ status: 403, message: 'Access denied', body: null }),
      refetch: vi.fn(),
    })
    await render('?view=settings')
    expect(container.textContent).toContain('Access denied')
    expect(container.textContent).not.toContain('Source configuration')
  })

  it('preserves the editable baseline across background connector updates', async () => {
    await render('?view=settings')
    mocks.detail.mockReturnValue({
      data: { ...connector, status: 'syncing', sourceConfig: { folderId: 'changed-remotely' } },
    })
    await render('?view=settings')
    expect(mocks.form).toHaveBeenLastCalledWith(expect.objectContaining({ connector }))
  })
})
