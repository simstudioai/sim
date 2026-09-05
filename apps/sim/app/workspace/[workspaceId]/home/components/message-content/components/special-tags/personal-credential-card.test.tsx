/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://sim.test/workspace/workspace-1/chat/chat-1" }
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersonalCredential } from '@/lib/api/contracts/credentials'
import type { CredentialItemData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'

const mocks = vi.hoisted(() => ({
  rows: [] as PersonalCredential[],
  fetched: true,
  metadataError: null as Error | null,
  startPending: false,
  canEdit: false,
  list: vi.fn(),
  start: vi.fn(),
  refetch: vi.fn(),
  workspaceCredentials: vi.fn(),
  personalEnvironment: vi.fn(),
  continue: vi.fn(),
  openExternal: vi.fn(),
  desktop: false,
  error: null as Error | null,
}))

vi.mock('next/navigation', () => ({ useParams: () => ({ workspaceId: 'workspace-1' }) }))
vi.mock('@/lib/desktop', () => ({
  getDesktopBridge: () => (mocks.desktop ? { openExternal: mocks.openExternal } : null),
}))
vi.mock('@/lib/auth/auth-client', () => ({ useSession: () => ({ data: null }) }))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({ canEdit: mocks.canEdit }),
}))
vi.mock('@/hooks/queries/personal-credentials', () => ({
  usePersonalCredentials: (workspaceId: string, options: unknown) => {
    mocks.list(workspaceId, options)
    return {
      data: mocks.rows,
      isFetched: mocks.fetched,
      isSuccess: mocks.fetched && !mocks.metadataError,
      isError: Boolean(mocks.metadataError),
      refetch: mocks.refetch,
      error: mocks.metadataError,
    }
  },
  useStartPersonalCredentialConnection: () => ({
    mutate: mocks.start,
    isPending: mocks.startPending,
    error: mocks.error,
  }),
}))
vi.mock('@/hooks/queries/credentials', () => ({
  useWorkspaceCredentials: (options: unknown) => {
    mocks.workspaceCredentials(options)
    return { data: [], refetch: vi.fn() }
  },
  useUpdateWorkspaceCredential: () => ({ mutateAsync: vi.fn() }),
  useWorkspaceCredential: () => ({ data: null }),
}))
vi.mock('@/hooks/queries/environment', () => ({
  usePersonalEnvironment: (options: unknown) => {
    mocks.personalEnvironment(options)
    return { data: {}, refetch: vi.fn() }
  },
  useSavePersonalEnvironment: () => ({ mutateAsync: vi.fn() }),
  useUpsertWorkspaceEnvironment: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/integrations/components/connect-personal-token-modal',
  () => ({
    ConnectPersonalTokenModal: ({
      onConnected,
      onOpenChange,
    }: {
      onConnected: () => void
      onOpenChange: (open: boolean) => void
    }) => (
      <div role='dialog'>
        <button
          type='button'
          onClick={() => {
            onConnected()
            onOpenChange(false)
          }}
        >
          Finish personal token
        </button>
      </div>
    ),
  })
)

import { OAUTH_CHAT_ATTEMPT_MAX_AGE_MS } from '@/lib/credentials/oauth-chat-attempt'
import { SpecialTags } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'

let root: Root
let container: HTMLDivElement
let popup: {
  closed: boolean
  close: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  opener: unknown
  location: { href: string }
}
const slack: CredentialItemData = {
  type: 'link',
  provider: 'slack',
  value: 'https://untrusted.example/authorize?credentialId=someone-else',
}

async function render(data: CredentialItemData[] = [slack]) {
  await act(async () =>
    root.render(
      <SpecialTags
        requestMode='assistant'
        segment={{ type: 'credential', data }}
        interactionId='message-1:0'
        onOptionSelect={mocks.continue}
      />
    )
  )
}

async function click(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === label
  )
  expect(button, label).toBeDefined()
  await act(async () => button?.click())
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  window.localStorage.clear()
  mocks.rows = []
  mocks.fetched = true
  mocks.metadataError = null
  mocks.startPending = false
  mocks.canEdit = false
  mocks.error = null
  mocks.desktop = false
  mocks.refetch.mockImplementation(async () => ({ isSuccess: true, data: mocks.rows }))
  mocks.openExternal.mockResolvedValue(true)
  mocks.start.mockImplementation((_body, callbacks) =>
    callbacks.onSuccess({
      providerId: 'slack',
      url: 'https://slack.com/oauth/v2/authorize?state=trusted-state',
    })
  )
  popup = {
    closed: false,
    close: vi.fn(),
    focus: vi.fn(),
    opener: {},
    location: { href: 'about:blank' },
  }
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Assistant credential card', () => {
  it('lets readers connect through the canonical endpoint without following the model URL', async () => {
    await render()
    await click('Connect Slack')
    expect(mocks.start).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', providerId: 'slack' },
      expect.any(Object)
    )
    expect(popup.location.href).toBe('https://slack.com/oauth/v2/authorize?state=trusted-state')
    expect(popup.opener).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(mocks.workspaceCredentials).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'oauth' })
    )
  })

  it('marks a connection complete from the personal list, closes its popup, and resumes through Submit', async () => {
    await render()
    await click('Connect Slack')
    mocks.rows = [
      {
        id: 'owned',
        providerId: 'slack',
        type: 'managed_oauth',
        displayName: 'My Slack',
        updatedAt: new Date().toISOString(),
        connectedAt: new Date().toISOString(),
      },
    ]
    await render()
    expect(container.textContent).toContain('Connected Slack')
    expect(popup.close).toHaveBeenCalled()
    await click('Submit')
    expect(mocks.continue).toHaveBeenCalledOnce()
    expect(mocks.continue.mock.calls[0][0]).toContain('connected')
  })

  it('does not claim an existing personal credential as this attempt completing', async () => {
    mocks.rows = [
      {
        id: 'owned',
        providerId: 'slack',
        type: 'managed_oauth',
        displayName: 'My Slack',
        updatedAt: '2026-01-01T00:00:00.000Z',
        connectedAt: '2026-01-01T00:00:00.000Z',
      },
    ]
    await render()
    await click('Connect Slack')
    await render()
    expect(container.textContent).toContain('Waiting for Slack connection')
    expect(popup.close).not.toHaveBeenCalled()
  })

  it('refreshes the baseline so a previously connected account missing from cache cannot complete the attempt', async () => {
    const existing: PersonalCredential = {
      id: 'owned',
      providerId: 'slack',
      type: 'managed_oauth',
      displayName: 'My Slack',
      updatedAt: '2026-01-01T00:00:00.000Z',
      connectedAt: '2026-01-01T00:00:00.000Z',
    }
    mocks.refetch.mockResolvedValue({ isSuccess: true, data: [existing] })
    await render()
    await click('Connect Slack')
    mocks.rows = [existing]
    await render()
    expect(mocks.refetch).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Waiting for Slack connection')
    expect(popup.close).not.toHaveBeenCalled()
  })

  it('does not start OAuth when the fresh baseline fails and offers metadata retry', async () => {
    mocks.refetch.mockImplementation(async () => {
      mocks.metadataError = new Error('Could not refresh your connections')
      return { isSuccess: false }
    })
    await render()
    await click('Connect Slack')
    await render()
    expect(mocks.start).not.toHaveBeenCalled()
    expect(popup.close).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Retry checking Slack connections')
    await click('Retry checking Slack connections')
    expect(mocks.refetch).toHaveBeenCalledTimes(2)
  })

  it('starts only once while the fresh metadata read is in flight', async () => {
    let resolveFresh!: (result: { isSuccess: boolean; data: PersonalCredential[] }) => void
    mocks.refetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFresh = resolve
        })
    )
    await render()
    await click('Connect Slack')
    await click('Connect Slack')
    expect(mocks.refetch).toHaveBeenCalledOnce()
    expect(window.open).toHaveBeenCalledOnce()
    expect(mocks.start).not.toHaveBeenCalled()
    await act(async () => resolveFresh({ isSuccess: true, data: [] }))
    expect(mocks.start).toHaveBeenCalledOnce()
  })

  it('does not complete on background refresh, but does complete on a new verified grant', async () => {
    const original = {
      id: 'owned',
      providerId: 'slack',
      type: 'managed_oauth' as const,
      displayName: 'My Slack',
      updatedAt: '2026-01-01T00:00:00.000Z',
      connectedAt: '2026-01-01T00:00:00.000Z',
    }
    mocks.rows = [original]
    await render()
    await click('Connect Slack')
    mocks.rows = [{ ...original, updatedAt: new Date().toISOString() }]
    await render()
    expect(container.textContent).toContain('Waiting for Slack connection')
    mocks.rows = [
      { ...original, updatedAt: new Date().toISOString(), connectedAt: new Date().toISOString() },
    ]
    await render()
    expect(container.textContent).toContain('Connected Slack')
  })

  it('requires successful metadata before starting and offers retry when the read fails', async () => {
    mocks.metadataError = new Error('Could not load your connections')
    await render()
    await click('Retry checking Slack connections')
    expect(mocks.refetch).toHaveBeenCalledOnce()
    expect(mocks.start).not.toHaveBeenCalled()
    expect(window.open).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Could not load your connections'
    )
  })

  it('rejects an insecure external OAuth URL and leaves the popup closed', async () => {
    mocks.start.mockImplementation((_body, callbacks) =>
      callbacks.onSuccess({ providerId: 'slack', url: 'http://untrusted.example/authorize' })
    )
    await render()
    await click('Connect Slack')
    expect(popup.location.href).toBe('about:blank')
    expect(popup.close).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Not connected — connect Slack')
  })

  it('keeps a failed start retryable and surfaces the server setup message', async () => {
    mocks.start.mockImplementation((_body, callbacks) => {
      mocks.error = new Error('Ask an admin to enable Slack')
      callbacks.onError(mocks.error)
    })
    await render()
    await click('Connect Slack')
    expect(popup.close).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Ask an admin to enable Slack'
    )
    expect(container.textContent).toContain('Not connected — connect Slack')
  })

  it('ends polling when a connection never completes', async () => {
    await render()
    await click('Connect Slack')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OAUTH_CHAT_ATTEMPT_MAX_AGE_MS)
    })
    expect(container.textContent).toContain('Not connected — connect Slack')
    expect(mocks.list).toHaveBeenLastCalledWith('workspace-1', {
      enabled: true,
      refetchInterval: false,
    })
    expect(popup.close).toHaveBeenCalled()
  })

  it('opens OAuth in the system browser on desktop and allows a deliberate retry', async () => {
    mocks.desktop = true
    await render()
    await click('Connect Slack')
    expect(window.open).not.toHaveBeenCalled()
    expect(mocks.openExternal).toHaveBeenCalledWith(
      'https://slack.com/oauth/v2/authorize?state=trusted-state'
    )
    await click('Waiting for Slack connection…')
    expect(mocks.start).toHaveBeenCalledTimes(2)
    expect(mocks.openExternal).toHaveBeenCalledTimes(2)
  })

  it('does not allow a desktop retry while the start request is still pending', async () => {
    mocks.desktop = true
    mocks.start.mockImplementation(() => {
      mocks.startPending = true
    })
    await render()
    await click('Connect Slack')
    await render()
    await click('Waiting for Slack connection…')
    expect(mocks.start).toHaveBeenCalledOnce()
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('focuses the live web popup and starts a fresh attempt once its handle is closed', async () => {
    await render()
    await click('Connect Slack')
    await click('Waiting for Slack connection…')
    expect(popup.focus).toHaveBeenCalledOnce()
    expect(mocks.start).toHaveBeenCalledOnce()
    popup.closed = true
    await click('Waiting for Slack connection…')
    expect(mocks.start).toHaveBeenCalledTimes(2)
    expect(window.open).toHaveBeenCalledTimes(2)
  })

  it('uses the existing GitLab personal token modal without posting a token to the chat', async () => {
    mocks.canEdit = true
    await render([{ type: 'link', provider: 'gitlab' }])
    await click('Connect GitLab')
    await click('Finish personal token')
    expect(mocks.start).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Connected GitLab')
    await click('Submit')
    expect(mocks.continue.mock.calls[0][0]).toContain('connected')
  })

  it('does not offer GitLab token creation to a reader', async () => {
    await render([{ type: 'link', provider: 'gitlab' }])
    expect(container.querySelector('button')).toBeNull()
  })

  it('hides workspace secrets, service accounts and API key reveals even for editors', async () => {
    mocks.canEdit = true
    await render([
      slack,
      { type: 'secret_input', name: 'HIDDEN_SECRET' },
      { type: 'service_account', provider: 'google-drive' },
      { type: 'sim_key', value: 'must-never-render' },
    ])
    expect(container.textContent).not.toContain('HIDDEN_SECRET')
    expect(container.textContent).not.toContain('service account')
    expect(container.textContent).not.toContain('must-never-render')
    expect(container.querySelector('input')).toBeNull()
    expect(mocks.personalEnvironment).toHaveBeenCalledWith({ enabled: false })
    expect(mocks.workspaceCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    )
  })
})
