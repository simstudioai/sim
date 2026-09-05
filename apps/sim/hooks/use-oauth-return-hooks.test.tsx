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
}))

vi.mock('@sim/emcn', () => ({ toast: { success: mocks.success, error: mocks.error } }))
vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
  useRouter: vi.fn(),
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
  type OAuthReturnContext,
  readOAuthReturnContext,
  writeOAuthReturnContext,
} from '@/lib/credentials/client-state'
import {
  useDesktopOAuthConnectListener,
  useOAuthReturnForKBConnectors,
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

function context(): OAuthReturnContext {
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
