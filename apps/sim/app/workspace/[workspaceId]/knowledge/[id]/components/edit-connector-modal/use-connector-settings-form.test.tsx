/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorData } from '@/lib/api/contracts/knowledge/connectors'

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  applyAccess: vi.fn(),
  settingsPending: false,
  accessPending: false,
}))

vi.mock('@/hooks/queries/kb/connectors', () => ({
  useUpdateConnector: () => ({ mutate: mocks.update, isPending: mocks.settingsPending }),
  useUpdateConnectorAccess: () => ({ mutate: mocks.applyAccess, isPending: mocks.accessPending }),
}))
vi.mock('@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-scope', () => ({
  useConnectorScope: () => ({
    scope: { kind: 'organization', organizationId: 'org-1' },
    canAdmin: true,
    memberAccessAvailable: true,
    mirroredAccessAvailable: true,
    hasMaxAccess: true,
  }),
}))
vi.mock('@/hooks/use-permission-config', () => ({
  usePermissionConfig: () => ({
    integrationAvailability: new Map([
      ['slack', { oauthAvailable: true, state: 'ready' }],
      ['slack_v2', { oauthAvailable: true, state: 'ready' }],
    ]),
    oauthServiceAvailability: new Map(),
    isIntegrationAvailabilityReady: true,
    isIntegrationAvailabilityFetching: false,
    integrationAvailabilityError: null,
    refetchIntegrationAvailability: vi.fn(),
  }),
}))

import { useConnectorSettingsForm } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/use-connector-settings-form'

function connector(overrides: Partial<ConnectorData> = {}): ConnectorData {
  return {
    id: 'connector-1',
    knowledgeBaseId: 'kb-search',
    connectorType: 'slack',
    credentialId: null,
    sourceConfig: {},
    syncMode: 'full',
    syncIntervalMinutes: 1440,
    status: 'active',
    lastSyncAt: null,
    lastSyncError: null,
    lastSyncDocCount: null,
    nextSyncAt: null,
    consecutiveFailures: 0,
    accessMode: 'members',
    viewerMembership: null,
    credentialGroupId: 'group-1',
    credentialGroupOptionId: 'option-1',
    memberSyncStatus: 'idle',
    lastMemberSyncAt: null,
    nextMemberSyncAt: null,
    lastMemberSyncError: null,
    memberSyncConsecutiveFailures: 0,
    accessRewritePending: false,
    createdAt: '2026-09-04T00:00:00Z',
    updatedAt: '2026-09-04T00:00:00Z',
    ...overrides,
  }
}

describe('shared connector settings form', () => {
  let container: HTMLDivElement
  let root: Root
  let form: ReturnType<typeof useConnectorSettingsForm>
  let onSaved: ReturnType<typeof vi.fn>
  let baseline: ConnectorData

  function Probe({ row, isSearchIndex = true }: { row: ConnectorData; isSearchIndex?: boolean }) {
    form = useConnectorSettingsForm({
      scope: { kind: 'organization', organizationId: 'org-1' },
      knowledgeBaseId: 'kb-search',
      isSearchIndex,
      connector: row,
      onSaved,
    })
    return null
  }

  function render(row = baseline, key = 'baseline', isSearchIndex = true) {
    act(() => root.render(<Probe key={key} row={row} isSearchIndex={isSearchIndex} />))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.settingsPending = false
    mocks.accessPending = false
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onSaved = vi.fn()
    baseline = connector()
    render()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('treats persisted JSONB label key order as an unchanged draft', () => {
    render(
      connector({
        connectorType: 'google_drive',
        accessMode: 'admin',
        sourceConfig: {
          folderId: 'folder-1',
          _sourceLabels: {
            fields: { folderId: [{ label: 'Project notes', id: 'folder-1' }] },
            identity: JSON.stringify([['folderId', ['folder-1']]]),
          },
        },
      }),
      'jsonb'
    )
    expect(form.dirty).toBe(false)
    expect(form.canSave).toBe(false)
    act(() => form.fieldsProps.onFieldChange('folderId', ['folder-2']))
    expect(form.dirty).toBe(true)
  })

  it('keeps a new member Gmail source clean and preserves its derived listing cap on save', () => {
    const sourceConfig = {
      label: ['INBOX'],
      dateRange: '7d',
      query: 'subject:SIM-SEARCH-QA',
      _canonicalModes: { label: 'advanced' },
      maxThreads: 0,
    }
    render(connector({ connectorType: 'gmail', sourceConfig }), 'gmail-members')

    const capField = form.fieldsProps.connectorConfig?.configFields.find(
      (field) => field.id === 'maxThreads'
    )!
    expect(capField).toBeDefined()
    expect(form.fieldsProps.isFieldVisible(capField)).toBe(false)
    expect(form.dirty).toBe(false)
    expect(form.canSave).toBe(false)

    act(() => form.fieldsProps.onFieldChange('query', 'subject:updated'))
    expect(form.dirty).toBe(true)
    expect(form.canSave).toBe(true)
    act(() => form.save())
    expect(mocks.update).toHaveBeenCalledWith(
      {
        knowledgeBaseId: 'kb-search',
        connectorId: baseline.id,
        updates: { sourceConfig: { ...sourceConfig, query: 'subject:updated' } },
      },
      expect.any(Object)
    )
  })

  it('keeps general knowledge-base listing caps editable and includes their changes on save', () => {
    const sourceConfig = {
      label: ['INBOX'],
      _canonicalModes: { label: 'basic' },
      maxThreads: '100',
    }
    render(
      connector({ connectorType: 'gmail', accessMode: 'workspace', sourceConfig }),
      'gmail-workspace',
      false
    )

    const capField = form.fieldsProps.connectorConfig?.configFields.find(
      (field) => field.id === 'maxThreads'
    )!
    expect(capField).toBeDefined()
    expect(form.fieldsProps.isFieldVisible(capField)).toBe(true)
    expect(form.dirty).toBe(false)

    act(() => form.fieldsProps.onFieldChange('maxThreads', '200'))
    expect(form.dirty).toBe(true)
    expect(form.canSave).toBe(true)
    act(() => form.save())
    expect(mocks.update).toHaveBeenCalledWith(
      {
        knowledgeBaseId: 'kb-search',
        connectorId: baseline.id,
        updates: { sourceConfig: { ...sourceConfig, maxThreads: '200' } },
      },
      expect.any(Object)
    )
  })

  it('guards access drafts separately from a settings save', () => {
    expect(form.dirty).toBe(false)
    expect(form.canSave).toBe(false)
    act(() => form.fieldsProps.onContentCredentialChange('indexing-account'))
    expect(form.dirty).toBe(true)
    expect(form.canSave).toBe(false)
    act(() => form.fieldsProps.onFieldChange('excludeChannels', 'legal'))
    act(() => form.save())
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.applyAccess).not.toHaveBeenCalled()

    act(() => form.fieldsProps.onResetAccess())
    expect(form.dirty).toBe(true)
    expect(form.canSave).toBe(true)
    act(() => form.fieldsProps.onFieldChange('excludeChannels', ''))
    expect(form.dirty).toBe(false)
  })

  it('returns the canonical saved row for an explicit editor reset', () => {
    act(() => form.fieldsProps.onFieldChange('excludeChannels', 'legal'))
    act(() => form.save())
    expect(mocks.update).toHaveBeenCalledWith(
      {
        knowledgeBaseId: 'kb-search',
        connectorId: baseline.id,
        updates: {
          sourceConfig: { excludeChannels: 'legal', _canonicalModes: { channel: 'basic' } },
        },
      },
      expect.any(Object)
    )
    expect(mocks.applyAccess).not.toHaveBeenCalled()
    const saved = connector({
      sourceConfig: { excludeChannels: 'legal', _canonicalModes: { channel: 'basic' } },
    })
    act(() => mocks.update.mock.calls[0][1].onSuccess(saved))
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(saved)

    render(saved, 'saved')
    expect(form.fieldsProps.sourceConfig.excludeChannels).toBe('legal')
    expect(form.dirty).toBe(false)
    expect(form.canSave).toBe(false)
  })

  it('applies indexing account changes through the separate access operation', () => {
    act(() => form.fieldsProps.onContentCredentialChange('indexing-account'))
    act(() => form.fieldsProps.onApplyAccess())
    expect(mocks.applyAccess).toHaveBeenCalledWith(
      {
        knowledgeBaseId: 'kb-search',
        connectorId: baseline.id,
        access: { accessMode: 'members', credentialId: 'indexing-account' },
      },
      expect.any(Object)
    )
    expect(mocks.update).not.toHaveBeenCalled()
    const saved = connector({ credentialId: 'indexing-account' })
    act(() => mocks.applyAccess.mock.calls[0][1].onSuccess(saved))
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(saved)
  })

  it('keeps a failed settings draft editable without signaling a save', () => {
    act(() => form.fieldsProps.onFieldChange('excludeChannels', 'legal'))
    act(() => form.save())
    act(() => mocks.update.mock.calls[0][1].onError(new Error('Source update failed')))
    expect(form.fieldsProps.error).toBe('Source update failed')
    expect(form.dirty).toBe(true)
    expect(form.canSave).toBe(true)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it.each(['settingsPending', 'accessPending'] as const)(
    'blocks page saving while %s is pending',
    (pending) => {
      act(() => form.fieldsProps.onFieldChange('excludeChannels', 'legal'))
      mocks[pending] = true
      render()
      expect(form.saving).toBe(true)
      expect(form.canSave).toBe(false)
      expect(form.dirty).toBe(true)
    }
  )
})
