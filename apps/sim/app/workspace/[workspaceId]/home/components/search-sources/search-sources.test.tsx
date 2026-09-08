/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceMemberConnector } from '@/lib/api/contracts/knowledge/connectors'

const mocks = vi.hoisted(() => ({
  rows: vi.fn(),
  admin: vi.fn(),
  enabled: vi.fn(),
  connect: vi.fn(),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useOptionalWorkspaceHostContext: () => ({ features: { knowledgeMemberAccess: mocks.enabled() } }),
}))
vi.mock('@/hooks/queries/workspace', () => ({
  useWorkspacePermissionsQuery: () => ({ data: { viewer: { isAdmin: mocks.admin() } } }),
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
  useWorkspaceMemberConnectors: () => ({ data: mocks.rows() }),
  memberConnectorKeys: { list: (id: string) => ['member-connectors', id] },
}))
vi.mock('@/hooks/use-member-enrollment', () => ({
  CONNECTABLE_MEMBERSHIPS: new Set(['invited', 'not_enrolled', 'needs_reauth']),
  useMemberEnrollment: () => ({
    connectSearchSource: mocks.connect,
    isAwaiting: () => false,
    isAwaitingSource: () => false,
    isPending: false,
    setupConnector: null,
  }),
}))
vi.mock('@/app/workspace/[workspaceId]/home/components/search-sources/source-setup-modal', () => ({
  SourceSetupModal: () => null,
}))
vi.mock('@/lib/integrations/credential-display', () => ({
  getIntegrationsForCredentialProvider: () => [],
}))
vi.mock('@/lib/oauth', () => ({
  getCanonicalScopesForProvider: () => [],
  getServiceConfigByProviderId: () => undefined,
  getServiceConfigByServiceId: (id: string) => ({ providerId: id, name: id, icon: () => null }),
}))
vi.mock('@/connectors/registry', () => ({
  CONNECTOR_META_REGISTRY: Object.fromEntries(
    ['confluence', 'google_drive', 'slack'].map((id) => [
      id,
      {
        id,
        name: id,
        search: true,
        icon: () => null,
        auth: { mode: 'oauth', provider: id },
        permissionScopedListing: { capFieldIds: [] },
        configFields: [],
      },
    ])
  ),
}))

import { SearchSources } from '@/app/workspace/[workspaceId]/home/components/search-sources/search-sources'

let container: HTMLDivElement
let root: Root
const source = (overrides: Partial<WorkspaceMemberConnector> = {}): WorkspaceMemberConnector => ({
  knowledgeBaseId: 'canonical-index',
  knowledgeBaseName: 'Renamed company index',
  knowledgeBaseIsSearchIndex: true,
  connectorId: 'source-one',
  connectorType: 'confluence',
  sourceDescription: 'company.atlassian.net · ENG',
  memberSyncStatus: 'idle',
  viewerMembership: 'not_enrolled',
  viewerDocumentCount: 0,
  ...overrides,
})
function mount(rows: WorkspaceMemberConnector[]) {
  mocks.rows.mockReturnValue(rows)
  act(() => root.render(<SearchSources workspaceId='workspace' />))
}
function chips() {
  return [...container.querySelectorAll('button')]
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.admin.mockReturnValue(false)
  mocks.enabled.mockReturnValue(true)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('home Search source connections', () => {
  it('lets a reader connect a configured source after the canonical index is renamed', () => {
    const connection = source()
    mount([connection])
    const chip = chips().find((button) => button.textContent === 'confluence')!
    expect(chip.disabled).toBe(false)
    act(() => chip.click())
    expect(mocks.connect).toHaveBeenCalledWith(
      'workspace',
      expect.objectContaining({ type: 'confluence' }),
      connection
    )
    expect(chips().find((button) => button.textContent === 'google_drive')?.disabled).toBe(true)
  })

  it('keeps distinct configured sites visible and connects only the selected source', () => {
    const first = source({ viewerMembership: 'connected', viewerDocumentCount: 2 })
    const second = source({
      connectorId: 'source-two',
      sourceDescription: 'other.atlassian.net · OPS',
    })
    mount([first, second])
    expect(container.textContent).toContain('company.atlassian.net · ENG')
    expect(container.textContent).toContain('other.atlassian.net · OPS')
    const chip = chips().find((button) => button.textContent?.includes('other.atlassian.net'))!
    act(() => chip.click())
    expect(mocks.connect).toHaveBeenCalledExactlyOnceWith(
      'workspace',
      expect.objectContaining({ type: 'confluence' }),
      second
    )
  })

  it('does not use a same-named ordinary knowledge base as the canonical index', () => {
    mount([source({ knowledgeBaseIsSearchIndex: false, knowledgeBaseName: 'Sim Search' })])
    expect(chips().every((button) => button.disabled)).toBe(true)
    expect(mocks.connect).not.toHaveBeenCalled()
  })

  it('does not offer stale cached connections after member access is disabled', () => {
    mocks.enabled.mockReturnValue(false)
    mount([source({ viewerMembership: 'connected', viewerDocumentCount: 99 })])
    expect(container.textContent).not.toContain('99 documents')
    expect(chips().every((button) => button.disabled)).toBe(true)
  })

  it.each(['revoked', 'unverified_email'] as const)(
    'does not re-enroll an account with %s access',
    (viewerMembership) => {
      mount([source({ viewerMembership })])
      const chip = chips().find((button) => button.textContent?.startsWith('confluence'))!
      expect(chip.getAttribute('aria-disabled')).toBe('true')
      act(() => chip.click())
      expect(mocks.connect).not.toHaveBeenCalled()
    }
  )
})
