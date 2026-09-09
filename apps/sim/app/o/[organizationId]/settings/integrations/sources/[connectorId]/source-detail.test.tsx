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
  integrations: vi.fn(),
  push: vi.fn(),
  documents: vi.fn(),
  actions: vi.fn(),
  recovery: vi.fn(),
  history: vi.fn(),
  form: vi.fn(),
  dirty: false,
  saving: false,
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
  '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-documents/connector-documents',
  () => ({
    ConnectorDocuments: (props: unknown) => {
      mocks.documents(props)
      return <p>Source documents</p>
    },
  })
)
vi.mock('@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section', () => ({
  ConnectorRecovery: (props: { onEdit?: () => void }) => {
    mocks.recovery(props)
    return props.onEdit ? <button onClick={props.onEdit}>Review source settings</button> : null
  },
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
    mocks.saving = false
    mocks.index.mockReturnValue({ data: { knowledgeBaseId: 'index-one' }, isPending: false })
    mocks.detail.mockReturnValue({ data: connector })
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
        { id: 'pause', text: 'Pause', disabled: options.disabled, onSelect: vi.fn() },
        { id: 'delete', text: 'Remove', disabled: options.disabled, onSelect: vi.fn() },
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
        isSearchIndex: true,
      })
    )
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await click('Sync history')
    expect(mocks.history).toHaveBeenCalled()
    await click('Google Drive')
    expect(mocks.push).toHaveBeenCalledWith(
      '/o/org-one/settings/integrations/providers/google_drive'
    )
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

  it.each(['', '?view=history'])(
    'shows a concise incomplete-update notice without provider details at %s',
    async (searchParams) => {
      mocks.detail.mockReturnValue({
        data: { ...connector, lastSyncError: 'Provider denied organization org-private-id' },
      })
      await render(searchParams)

      expect(container.textContent).toContain('Some source updates are incomplete')
      expect(container.textContent).toContain('Review the source settings and try syncing again.')
      expect(container.textContent).not.toContain('Provider denied')
      expect(container.textContent).not.toContain('org-private-id')
    }
  )

  it('keeps a healthy active source quiet', async () => {
    await render()
    expect(container.textContent).not.toContain('Some source updates are incomplete')
    expect(container.textContent).not.toContain('Review the source settings and try syncing again.')
  })

  it.each(['', '?view=settings', '?view=history'])(
    'shows integration deactivation independently of source sync state at %s',
    async (searchParams) => {
      mocks.detail.mockReturnValue({ data: { ...connector, status: 'paused' } })
      mocks.integrations.mockReturnValue({
        data: [{ connectorType: 'google_drive', approved: false }],
      })
      await render(searchParams)
      expect(mocks.integrations).toHaveBeenCalledWith('org-one')
      expect(container.textContent).toContain('Google Drive is deactivated')
      expect(container.textContent).toContain(
        'Its content is unavailable in Search, Assistant, and MCP.'
      )
      expect(container.textContent).toContain('Sync paused')
    }
  )

  it('keeps source settings and their guard when integration status cannot refresh', async () => {
    mocks.dirty = true
    const refetch = vi.fn()
    mocks.integrations.mockReturnValue({
      isError: true,
      error: new Error('Integration status unavailable'),
      refetch,
    })
    await render('?view=settings')
    expect(container.textContent).toContain('Source configuration')
    expect(container.textContent).toContain('Integration status unavailable')
    expect(container.textContent).not.toContain('is deactivated')
    await click('Try again')
    expect(refetch).toHaveBeenCalledOnce()
    await click('Google Drive')
    expect(mocks.push).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Unsaved Changes')
  })

  it.each(['pending', 'syncing', 'paused', 'error', 'disabled'] as const)(
    'does not duplicate recovery feedback for a %s source',
    async (status) => {
      mocks.detail.mockReturnValue({ data: { ...connector, status, lastSyncError: 'Old failure' } })
      await render()
      expect(container.textContent).not.toContain('Some source updates are incomplete')
    }
  )

  it.each([
    ['active', 'idle', true],
    ['active', 'pending', false],
    ['active', 'running', false],
    ['active', 'error', false],
    ['active', 'disabled', false],
    ['paused', 'idle', false],
    ['disabled', 'idle', false],
  ] as const)(
    'uses effective member state for status=%s, memberSyncStatus=%s: notice=%s',
    async (status, memberSyncStatus, showNotice) => {
      mocks.detail.mockReturnValue({
        data: {
          ...connector,
          accessMode: 'members',
          status,
          memberSyncStatus,
          lastSyncError: null,
          lastMemberSyncError: 'Member listing incomplete: private-account-id',
        },
      })
      await render()
      expect(container.textContent?.includes('Some source updates are incomplete')).toBe(showNotice)
      expect(container.textContent).not.toContain('private-account-id')
    }
  )

  it('opens the existing source settings through the recovery action without leaving the source', async () => {
    mocks.detail.mockReturnValue({ data: { ...connector, lastSyncError: 'Listing incomplete' } })
    await render()
    expect(mocks.recovery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        knowledgeBaseId: 'index-one',
        scope: { kind: 'organization', organizationId: 'org-one' },
        onEdit: expect.any(Function),
      })
    )

    await click('Review source settings')
    expect(container.textContent).toContain('Source configuration')
    expect(mocks.form).toHaveBeenCalledWith(
      expect.objectContaining({ connector: expect.objectContaining({ id: 'source-one' }) })
    )
    expect(mocks.push).not.toHaveBeenCalled()
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
    expect(mocks.integrations).not.toHaveBeenCalled()
  })
  it('shows a missing source when there is no search index', async () => {
    mocks.index.mockReturnValue({ data: { knowledgeBaseId: null }, isPending: false })
    mocks.detail.mockReturnValue({})
    await render()
    expect(container.textContent).toContain('This source is no longer available')
    expect(mocks.actions).not.toHaveBeenCalled()
    await click('Sources')
    expect(mocks.push).toHaveBeenCalledWith('/o/org-one/settings/integrations')
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
    await click('Google Drive')
    expect(mocks.push).not.toHaveBeenCalled()
    await click('Discard Changes')
    expect(mocks.push).toHaveBeenCalledWith(
      '/o/org-one/settings/integrations/providers/google_drive'
    )
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

  it('hides cached source settings when integration status reports revoked access', async () => {
    await render('?view=settings')
    mocks.integrations.mockReturnValue({
      data: [{ connectorType: 'google_drive', approved: true }],
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

  it('uses the canonical saved row as the new settings baseline without leaving the source', async () => {
    mocks.dirty = true
    await render('?view=settings')
    await click('Save')
    expect(mocks.save).toHaveBeenCalledOnce()

    const saved = { ...connector, sourceConfig: { folderId: 'saved-folder' } }
    await act(async () => mocks.form.mock.calls.at(-1)![0].onSaved(saved))
    expect(mocks.form).toHaveBeenLastCalledWith(expect.objectContaining({ connector: saved }))
    expect(mocks.push).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Source configuration')

    mocks.detail.mockReturnValue({ data: { ...connector, status: 'syncing' } })
    await render('?view=settings')
    expect(mocks.form).toHaveBeenLastCalledWith(expect.objectContaining({ connector: saved }))
  })

  it('discards to the latest server settings only when explicitly requested', async () => {
    mocks.dirty = true
    await render('?view=settings')
    const refreshed = { ...connector, sourceConfig: { folderId: 'latest-server-folder' } }
    mocks.detail.mockReturnValue({ data: refreshed })
    await render('?view=settings')
    expect(mocks.form).toHaveBeenLastCalledWith(expect.objectContaining({ connector }))

    await click('Discard')
    expect(mocks.form).toHaveBeenLastCalledWith(expect.objectContaining({ connector: refreshed }))
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Source configuration')
  })

  it.each([false, true])(
    'blocks source navigation and repeated actions while saving with dirty=%s',
    async (dirty) => {
      mocks.dirty = dirty
      mocks.saving = true
      await render('?view=settings')
      for (const label of [
        'Sync now',
        'Pause',
        'Remove',
        'Saving...',
        ...(dirty ? ['Discard'] : []),
      ]) {
        const action = Array.from(container.querySelectorAll('button')).find(
          (item) => item.textContent === label
        )
        expect(action).toBeDisabled()
      }

      await click('Documents')
      await click('Sync history')
      await click('Google Drive')
      expect(mocks.documents).not.toHaveBeenCalled()
      expect(mocks.history).not.toHaveBeenCalled()
      expect(mocks.push).not.toHaveBeenCalled()
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(container.textContent).toContain('Source configuration')
    }
  )
})
