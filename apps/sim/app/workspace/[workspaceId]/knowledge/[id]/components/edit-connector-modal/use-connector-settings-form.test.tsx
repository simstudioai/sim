/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import {
  createMockDeploymentShape,
  deploymentShapeMock,
  deploymentShapeMockFns,
} from '@sim/testing/mocks/deployment-shape.mock'
import {
  kbConnectorsQueriesMock,
  kbConnectorsQueriesMockFns,
} from '@sim/testing/mocks/kb-connectors-queries.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorData } from '@/lib/api/contracts/knowledge/connectors'

const mocks = vi.hoisted(() => ({
  live: false,
  update: vi.fn(),
  applyAccess: vi.fn(),
  settingsPending: false,
  accessPending: false,
}))

vi.mock('@/lib/core/config/deployment-shape', () => deploymentShapeMock)

vi.mock('@/hooks/queries/kb/connectors', () => kbConnectorsQueriesMock)
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
    oauthServiceAvailability: new Map([
      ['github-repositories', true],
      ['confluence', true],
    ]),
    isIntegrationAvailabilityReady: true,
    isIntegrationAvailabilityFetching: false,
    integrationAvailabilityError: null,
    refetchIntegrationAvailability: vi.fn(),
  }),
}))

import { useConnectorSettingsForm } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/use-connector-settings-form'

deploymentShapeMockFns.mockUseDeploymentShape.mockImplementation(() =>
  createMockDeploymentShape({ features: { liveEnterpriseSearch: mocks.live } })
)
kbConnectorsQueriesMockFns.mockUseUpdateConnector.mockImplementation(() => ({
  mutate: mocks.update,
  isPending: mocks.settingsPending,
}))
kbConnectorsQueriesMockFns.mockUseUpdateConnectorAccess.mockImplementation(() => ({
  mutate: mocks.applyAccess,
  isPending: mocks.accessPending,
}))

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
    mocks.live = false
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

  it('saves an account replacement and source edits together and retains the draft on rejection', () => {
    const row = connector({
      connectorType: 'confluence',
      accessMode: 'admin',
      credentialId: 'old-account',
      sourceConfig: { domain: 'example.atlassian.net', spaceKey: ['ENG'] },
    })
    render(row, 'replacement')
    act(() => form.fieldsProps.onWorkspaceCredentialChange('new-account'))
    act(() => form.fieldsProps.onFieldChange('labelFilter', 'published'))
    expect(form.canSave).toBe(true)
    act(() => form.save())
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.applyAccess).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        access: expect.objectContaining({
          accessMode: 'admin',
          credentialId: 'new-account',
          sourceConfig: expect.objectContaining({ labelFilter: 'published' }),
        }),
      }),
      expect.any(Object)
    )
    act(() =>
      mocks.applyAccess.mock.calls[0][1].onError(new Error('Account cannot access this space'))
    )
    expect(form.fieldsProps.workspaceCredentialId).toBe('new-account')
    expect(form.fieldsProps.sourceConfig.labelFilter).toBe('published')
    expect(form.canSave).toBe(true)
    expect(onSaved).not.toHaveBeenCalled()
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

  it('preserves the GitHub repository and pending connection after an incompatible replacement is refused', () => {
    const sourceConfig = { repository: 'acme/platform', branch: 'main' }
    render(
      connector({
        connectorType: 'github',
        credentialId: 'installation-1',
        sourceConfig: { ...sourceConfig, githubRepositoryId: '123' },
      }),
      'github-replacement'
    )
    act(() => form.fieldsProps.onContentCredentialChange('installation-1'))
    expect(form.fieldsProps.accessDirty).toBe(false)
    expect(form.fieldsProps.sourceConfig).toMatchObject(sourceConfig)
    expect(form.fieldsProps.usesGitHubInstallation).toBe(true)

    act(() => form.fieldsProps.onFieldChange('pathPrefix', 'docs/'))
    act(() => form.fieldsProps.onContentCredentialChange('installation-2'))
    expect(form.fieldsProps.sourceConfig).toMatchObject({ ...sourceConfig, pathPrefix: 'docs/' })
    expect(form.fieldsProps.accessDirty).toBe(true)
    expect(form.canSave).toBe(false)
    act(() => form.fieldsProps.onApplyAccess())
    expect(mocks.applyAccess).toHaveBeenCalledExactlyOnceWith(
      {
        knowledgeBaseId: 'kb-search',
        connectorId: 'connector-1',
        access: { accessMode: 'members', credentialId: 'installation-2' },
      },
      expect.any(Object)
    )
    const message =
      "This GitHub connection cannot access this source's repository. Choose a connection with access to the same repository, or add a new source for a different repository."
    act(() => mocks.applyAccess.mock.calls[0][1].onError(new Error(message)))
    expect(form.fieldsProps.error).toBe(message)
    expect(form.fieldsProps.contentCredentialId).toBe('installation-2')
    expect(form.fieldsProps.sourceConfig).toMatchObject({ ...sourceConfig, pathPrefix: 'docs/' })
    expect(form.fieldsProps.accessDirty).toBe(true)
    expect(onSaved).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()

    act(() => form.fieldsProps.onResetAccess())
    expect(form.fieldsProps.contentCredentialId).toBe('installation-1')
    expect(form.fieldsProps.accessDirty).toBe(false)
    expect(form.fieldsProps.sourceConfig).toMatchObject({ ...sourceConfig, pathPrefix: 'docs/' })
    expect(form.canSave).toBe(true)
  })
})
