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
