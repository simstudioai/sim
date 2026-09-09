/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import type { DesktopOAuthConnectResult } from '@sim/desktop-bridge'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  desktop: false,
  onOAuthConnectComplete: vi.fn(),
  requestJson: vi.fn(),
  requireWorkspaceCredentialListResponse: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  replace: vi.fn(),
  params: { workspaceId: 'workspace-1' } as { workspaceId?: string; organizationId?: string },
}))

vi.mock('@sim/emcn', () => ({ toast: { success: mocks.success, error: mocks.error } }))
vi.mock('next/navigation', () => ({
  useParams: () => mocks.params,
  useRouter: () => ({ replace: mocks.replace }),
}))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.requestJson }))
vi.mock('@/lib/desktop', () => ({
  getDesktopBridge: () =>
    mocks.desktop ? { onOAuthConnectComplete: mocks.onOAuthConnectComplete } : undefined,
}))
vi.mock('@/hooks/queries/oauth/oauth-connections', () => ({
  oauthConnectionsKeys: { connections: () => ['oauthConnections'] },
}))
vi.mock('@/hooks/queries/utils/fetch-workspace-credentials', () => ({
  requireWorkspaceCredentialListResponse: mocks.requireWorkspaceCredentialListResponse,
}))

import {
  listOrganizationCredentialsContract,
  listOrganizationOAuthCredentialsContract,
} from '@/lib/api/contracts/organization-credentials'
import {
  type OAuthReturnContext,
  readOAuthReturnContext,
  writeOAuthReturnContext,
} from '@/lib/credentials/client-state'
import { oauthCredentialKeys, useOAuthCredentials } from '@/hooks/queries/oauth/oauth-credentials'
import { useCredentialRefreshTriggers } from '@/hooks/use-credential-refresh-triggers'
import {
  useDesktopOAuthConnectListener,
  useOAuthReturnForKBConnectors,
  useOAuthReturnRouter,
} from '@/hooks/use-oauth-return'

const UPDATED_EVENT = 'oauth-credentials-updated'
const EXISTING_CREDENTIAL = {
  id: 'credential-existing',
  providerId: 'google-drive',
  displayName: 'Existing Drive',
  accountId: 'account-existing',
  updatedAt: '2026-09-05T00:00:00Z',
}
const NEW_CREDENTIAL = {
  ...EXISTING_CREDENTIAL,
  id: 'credential-new',
  displayName: 'New Drive',
  accountId: 'account-new',
}

function context(): Extract<OAuthReturnContext, { origin: 'kb-connectors' }> {
  return {
    origin: 'kb-connectors',
    workspaceId: 'workspace-1',
    knowledgeBaseId: 'kb-search',
    connectorType: 'google_drive',
    providerId: 'google-drive',
    displayName: 'New Drive',
    preCount: 1,
    baselineCredentials: [EXISTING_CREDENTIAL],
    requestedAt: Date.now(),
  }
}

interface ProbeProps {
  knowledgeBaseId?: string
  connectorType?: string
  onConnected: (credentialId: string) => void
}

function Probe({
  knowledgeBaseId = 'kb-search',
  connectorType = 'google_drive',
  onConnected,
}: ProbeProps) {
  useDesktopOAuthConnectListener()
  useOAuthReturnForKBConnectors(knowledgeBaseId, onConnected, connectorType)
  return null
}

function RouterProbe() {
  useOAuthReturnRouter()
  return null
}

function SourceSettingsProbe({ connectorId }: { connectorId: string }) {
  const scope = { kind: 'organization' as const, organizationId: 'org-1' }
  const credentials = useOAuthCredentials('google-drive', { organizationId: scope.organizationId })
  useCredentialRefreshTriggers(credentials.refetch, 'google-drive', scope)
  useOAuthReturnForKBConnectors('kb-search', undefined, 'google_drive', scope, connectorId)
  return <output>{credentials.data?.map((credential) => credential.name).join(', ')}</output>
}

let root: Root
let container: HTMLDivElement
let queryClient: QueryClient
let completeDesktop: ((result: DesktopOAuthConnectResult) => void) | undefined

async function render(props: ProbeProps) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe {...props} />
      </QueryClientProvider>
    )
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.desktop = false
  mocks.params = { workspaceId: 'workspace-1' }
  completeDesktop = undefined
  mocks.onOAuthConnectComplete.mockImplementation(
    (callback: (result: DesktopOAuthConnectResult) => void) => {
      completeDesktop = callback
      return () => {
        completeDesktop = undefined
      }
    }
  )
  mocks.requestJson.mockResolvedValue({})
  mocks.requireWorkspaceCredentialListResponse.mockReturnValue([
    EXISTING_CREDENTIAL,
    NEW_CREDENTIAL,
  ])
  sessionStorage.clear()
  window.history.replaceState(null, '', '/workspace/workspace-1/search?addConnector=google_drive')
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(async () => {
  await act(async () => root.unmount())
  queryClient.clear()
  container.remove()
  sessionStorage.clear()
})

describe('organization source OAuth return routing', () => {
  async function renderRouter() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <RouterProbe />
        </QueryClientProvider>
      )
    })
  }

  it.each(['confluence', 'google_drive', 'github', 'jira', 'gmail', 'google_calendar', 'slack'])(
    'preserves the %s member-source form on successful and canceled OAuth returns',
    async (connectorType) => {
      mocks.params = { organizationId: 'org-1' }
      for (const canceled of [false, true]) {
        const pending: OAuthReturnContext = {
          ...context(),
          workspaceId: undefined,
          organizationId: 'org-1',
          connectorType,
          sourceAccess: 'members',
        }
        writeOAuthReturnContext(pending)
        window.history.replaceState(
          null,
          '',
          `/o/org-1/settings/integrations${canceled ? '?error=access_denied' : ''}`
        )
        await renderRouter()
        expect(mocks.replace).toHaveBeenLastCalledWith(
          `/o/org-1/settings/integrations?addConnector=${connectorType}&source-access=members`
        )
        expect(readOAuthReturnContext()).toEqual(canceled ? null : pending)
        await act(async () => root.render(null))
      }
    }
  )

  it.each([false, true])(
    'returns to source settings after OAuth with canceled=%s',
    async (canceled) => {
      mocks.params = { organizationId: 'org-1' }
      const pending: OAuthReturnContext = {
        ...context(),
        workspaceId: undefined,
        organizationId: 'org-1',
        connectorId: 'connector-1',
      }
      writeOAuthReturnContext(pending)
      window.history.replaceState(
        null,
        '',
        `/o/org-1/settings/integrations${canceled ? '?error=access_denied' : ''}`
      )

      await renderRouter()

      expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
        '/o/org-1/settings/integrations/sources/connector-1?view=settings'
      )
      expect(readOAuthReturnContext()).toEqual(canceled ? null : pending)
      expect(mocks.requestJson).not.toHaveBeenCalled()
    }
  )

  it('keeps new-source OAuth returns on the existing setup form', async () => {
    mocks.params = { organizationId: 'org-1' }
    writeOAuthReturnContext({
      ...context(),
      workspaceId: undefined,
      organizationId: 'org-1',
    })

    await renderRouter()

    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
      '/o/org-1/settings/integrations?addConnector=google_drive'
    )
  })

  it('does not route a pending source return through a different organization', async () => {
    mocks.params = { organizationId: 'org-other' }
    const pending: OAuthReturnContext = {
      ...context(),
      workspaceId: undefined,
      organizationId: 'org-1',
      connectorId: 'connector-1',
    }
    writeOAuthReturnContext(pending)

    await renderRouter()

    expect(mocks.replace).not.toHaveBeenCalled()
    expect(readOAuthReturnContext()).toEqual(pending)
  })
})

describe('existing source settings OAuth return', () => {
  async function renderSettings(connectorId: string) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SourceSettingsProbe connectorId={connectorId} />
        </QueryClientProvider>
      )
    })
  }

  beforeEach(() => {
    queryClient.setQueryData(oauthCredentialKeys.list('google-drive', '', '', 'org-1'), [
      { id: 'credential-existing', name: 'Cached account' },
    ])
    mocks.requestJson.mockImplementation(async (contract: unknown) => {
      if (contract === listOrganizationOAuthCredentialsContract) {
        return { credentials: [{ id: 'credential-existing', name: 'Updated account' }] }
      }
      if (contract === listOrganizationCredentialsContract) {
        return {
          credentials: [
            {
              id: 'service-account',
              displayName: 'Service account',
              providerId: 'google-service-account',
            },
          ],
        }
      }
      throw new Error('Unexpected account request')
    })
  })

  it('consumes a matching source return and refreshes fresh cached account options', async () => {
    writeOAuthReturnContext({
      ...context(),
      workspaceId: undefined,
      organizationId: 'org-1',
      connectorId: 'connector-1',
      reconnect: true,
    })

    await renderSettings('connector-1')

    expect(readOAuthReturnContext()).toBeNull()
    expect(mocks.requestJson).toHaveBeenCalledTimes(2)
    expect(mocks.requestJson).toHaveBeenCalledWith(
      listOrganizationCredentialsContract,
      expect.objectContaining({
        query: {
          organizationId: 'org-1',
          providerId: 'google-service-account',
          type: 'service_account',
        },
      })
    )
    await vi.waitFor(() => expect(container.textContent).toBe('Updated account, Service account'))
  })

  it('preserves an OAuth return for another source of the same provider', async () => {
    const pending: OAuthReturnContext = {
      ...context(),
      workspaceId: undefined,
      organizationId: 'org-1',
      connectorId: 'connector-1',
      reconnect: true,
    }
    writeOAuthReturnContext(pending)

    await renderSettings('connector-other')

    expect(readOAuthReturnContext()).toEqual(pending)
    expect(mocks.requestJson).not.toHaveBeenCalled()
    expect(container.textContent).toBe('Cached account')
  })
})

describe('KB OAuth return account selection', () => {
  it('verifies a web return and selects the connected account once', async () => {
    writeOAuthReturnContext(context())
    const onConnected = vi.fn()
    const updates = vi.fn()
    window.addEventListener(UPDATED_EVENT, updates)
    try {
      await render({ onConnected })
      expect(onConnected).toHaveBeenCalledExactlyOnceWith('credential-new')
      expect(readOAuthReturnContext()).toBeNull()
      expect(updates).toHaveBeenCalledOnce()
      expect(updates.mock.calls[0][0].detail).toMatchObject({
        providerId: 'google-drive',
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-search',
        connectorType: 'google_drive',
        credentialId: 'credential-new',
      })
    } finally {
      window.removeEventListener(UPDATED_EVENT, updates)
    }
  })

  it('preserves a return for a different source in the same knowledge base', async () => {
    const pending = context()
    writeOAuthReturnContext(pending)
    const onConnected = vi.fn()
    await render({ onConnected, connectorType: 'confluence' })
    expect(readOAuthReturnContext()).toEqual(pending)
    expect(mocks.requestJson).not.toHaveBeenCalled()
    expect(onConnected).not.toHaveBeenCalled()
  })

  it('clears a canceled web return without selecting an account', async () => {
    writeOAuthReturnContext(context())
    window.history.replaceState(null, '', '?addConnector=google_drive&error=access_denied')
    const onConnected = vi.fn()
    await render({ onConnected })
    expect(onConnected).not.toHaveBeenCalled()
    expect(mocks.requestJson).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledOnce()
    expect(readOAuthReturnContext()).toBeNull()
    expect(window.location.search).not.toContain('error=')
  })

  it('does not select an account when web verification fails', async () => {
    writeOAuthReturnContext(context())
    mocks.requireWorkspaceCredentialListResponse.mockReturnValue([EXISTING_CREDENTIAL])
    const onConnected = vi.fn()
    await render({ onConnected })
    expect(onConnected).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledOnce()
  })

  it('discards expired web return context', async () => {
    writeOAuthReturnContext({ ...context(), requestedAt: Date.now() - 16 * 60 * 1000 })
    const onConnected = vi.fn()
    await render({ onConnected })
    expect(onConnected).not.toHaveBeenCalled()
    expect(mocks.requestJson).not.toHaveBeenCalled()
    expect(readOAuthReturnContext()).toBeNull()
  })

  it('waits for desktop completion and selects its verified account on the mounted form', async () => {
    mocks.desktop = true
    const pending = context()
    writeOAuthReturnContext(pending)
    const onConnected = vi.fn()
    await render({ onConnected })
    expect(readOAuthReturnContext()).toEqual(pending)
    expect(mocks.requestJson).not.toHaveBeenCalled()
    await act(async () => completeDesktop?.({ ok: true }))
    expect(onConnected).toHaveBeenCalledExactlyOnceWith('credential-new')
    expect(readOAuthReturnContext()).toBeNull()
  })

  it.each(['failed', 'expired', 'unverified'])(
    'does not select an account for %s desktop completion',
    async (outcome) => {
      mocks.desktop = true
      const onConnected = vi.fn()
      await render({ onConnected })
      writeOAuthReturnContext({
        ...context(),
        ...(outcome === 'expired' && { requestedAt: Date.now() - 16 * 60 * 1000 }),
      })
      if (outcome === 'unverified') {
        mocks.requireWorkspaceCredentialListResponse.mockReturnValue([EXISTING_CREDENTIAL])
      }
      await act(async () => completeDesktop?.({ ok: outcome !== 'failed' }))
      expect(onConnected).not.toHaveBeenCalled()
      expect(readOAuthReturnContext()).toBeNull()
      if (outcome !== 'unverified') expect(mocks.requestJson).not.toHaveBeenCalled()
    }
  )

  it('ignores completion for a source that the user has switched away from', async () => {
    mocks.desktop = true
    const onConnected = vi.fn()
    await render({ onConnected })
    writeOAuthReturnContext(context())
    await render({ onConnected, connectorType: 'confluence' })
    await act(async () => completeDesktop?.({ ok: true }))
    expect(onConnected).not.toHaveBeenCalled()
  })

  it.each([
    { knowledgeBaseId: 'kb-other' },
    { workspaceId: 'workspace-other' },
    { connectorType: 'confluence' },
    { credentialId: undefined },
    { requestedAt: undefined },
    { requestedAt: Date.now() - 16 * 60 * 1000 },
  ])('ignores unrelated or incomplete credential updates: %j', async (override) => {
    const onConnected = vi.fn()
    await render({ onConnected })
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(UPDATED_EVENT, {
          detail: {
            workspaceId: 'workspace-1',
            providerId: 'google-drive',
            knowledgeBaseId: 'kb-search',
            connectorType: 'google_drive',
            credentialId: 'credential-new',
            requestedAt: Date.now(),
            ...override,
          },
        })
      )
    })
    expect(onConnected).not.toHaveBeenCalled()
  })
})
