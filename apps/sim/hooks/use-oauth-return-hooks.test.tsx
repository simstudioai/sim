/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import type { DesktopOAuthConnectResult } from '@sim/desktop-bridge'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { emcnMock, emcnMockFns } from '@sim/testing/mocks/emcn.mock'
import { libDesktopMock, libDesktopMockFns } from '@sim/testing/mocks/lib-desktop.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  desktop: false,
  onOAuthConnectComplete: vi.fn(),
  requireWorkspaceCredentialListResponse: vi.fn(),
}))

vi.mock('@sim/emcn', () => emcnMock)
vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
vi.mock('@/lib/desktop', () => libDesktopMock)
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

const mockReplace = nextNavigationMockFns.router.replace
nextNavigationMockFns.mockUseParams.mockReturnValue({ workspaceId: 'workspace-1' })

const mockRequestJson = apiClientRequestMockFns.mockRequestJson
const { success: mockToastSuccess, error: mockToastError } = emcnMockFns.mockToast
libDesktopMockFns.mockGetDesktopBridge.mockImplementation(() =>
  mocks.desktop ? { onOAuthConnectComplete: mocks.onOAuthConnectComplete } : undefined
)

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
  mocks.desktop = false
  nextNavigationMockFns.mockUseParams.mockReturnValue({ workspaceId: 'workspace-1' })
  completeDesktop = undefined
  mocks.onOAuthConnectComplete.mockImplementation(
    (callback: (result: DesktopOAuthConnectResult) => void) => {
      completeDesktop = callback
      return () => {
        completeDesktop = undefined
      }
    }
  )
  mockRequestJson.mockResolvedValue({})
  mocks.requireWorkspaceCredentialListResponse.mockReturnValue([
    EXISTING_CREDENTIAL,
    NEW_CREDENTIAL,
  ])
  sessionStorage.clear()
  window.history.replaceState(null, '', '/o/org-1/settings/integrations?addConnector=google_drive')
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

  it('does not route a pending source return through a different organization', async () => {
    nextNavigationMockFns.mockUseParams.mockReturnValue({ organizationId: 'org-other' })
    const pending: OAuthReturnContext = {
      ...context(),
      workspaceId: undefined,
      organizationId: 'org-1',
      connectorId: 'connector-1',
    }
    writeOAuthReturnContext(pending)

    await renderRouter()

    expect(mockReplace).not.toHaveBeenCalled()
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
    mockRequestJson.mockImplementation(async (contract: unknown) => {
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
    expect(mockRequestJson).not.toHaveBeenCalled()
    expect(container.textContent).toBe('Cached account')
  })
})

describe('KB OAuth return account selection', () => {
  it('preserves a return for a different source in the same knowledge base', async () => {
    const pending = context()
    writeOAuthReturnContext(pending)
    const onConnected = vi.fn()
    await render({ onConnected, connectorType: 'confluence' })
    expect(readOAuthReturnContext()).toEqual(pending)
    expect(mockRequestJson).not.toHaveBeenCalled()
    expect(onConnected).not.toHaveBeenCalled()
  })

  it('does not select an account when web verification fails', async () => {
    writeOAuthReturnContext(context())
    mocks.requireWorkspaceCredentialListResponse.mockReturnValue([EXISTING_CREDENTIAL])
    const onConnected = vi.fn()
    await render({ onConnected })
    expect(onConnected).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledOnce()
  })

  it('discards expired web return context', async () => {
    writeOAuthReturnContext({ ...context(), requestedAt: Date.now() - 16 * 60 * 1000 })
    const onConnected = vi.fn()
    await render({ onConnected })
    expect(onConnected).not.toHaveBeenCalled()
    expect(mockRequestJson).not.toHaveBeenCalled()
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
      if (outcome !== 'unverified') expect(mockRequestJson).not.toHaveBeenCalled()
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
})
