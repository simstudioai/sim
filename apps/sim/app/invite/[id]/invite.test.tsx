/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCancelQueries,
  mockGetSession,
  mockInvalidateQueries,
  mockLogger,
  mockPush,
  mockRequestJson,
  mockSearchParams,
  mockSetActive,
  mockSetQueryData,
  mockSignOut,
  mockUseSession,
} = vi.hoisted(() => ({
  mockCancelQueries: vi.fn(),
  mockGetSession: vi.fn(),
  mockInvalidateQueries: vi.fn(),
  mockLogger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
  mockPush: vi.fn(),
  mockRequestJson: vi.fn(),
  mockSearchParams: { current: new URLSearchParams('token=token-1') },
  mockSetActive: vi.fn(),
  mockSetQueryData: vi.fn(),
  mockSignOut: vi.fn(),
  mockUseSession: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'invitation-1' }),
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams.current,
}))

vi.mock('@tanstack/react-query', async () => {
  const React = await import('react')
  return {
    useQueryClient: () => ({
      cancelQueries: mockCancelQueries,
      invalidateQueries: mockInvalidateQueries,
      setQueryData: mockSetQueryData,
    }),
    /**
     * Minimal useQuery stand-in: runs the queryFn once when enabled and
     * exposes { data, error, isPending } — enough for the invitation fetch.
     */
    useQuery: (options: {
      queryFn: (context: { signal?: AbortSignal }) => Promise<unknown>
      enabled?: boolean
    }) => {
      const [state, setState] = React.useState<{
        data: unknown
        error: unknown
        isPending: boolean
      }>({ data: undefined, error: null, isPending: true })
      const enabled = options.enabled !== false
      React.useEffect(() => {
        if (!enabled) return
        let cancelled = false
        options.queryFn({}).then(
          (data) => {
            if (!cancelled) setState({ data, error: null, isPending: false })
          },
          (error) => {
            if (!cancelled) setState({ data: undefined, error, isPending: false })
          }
        )
        return () => {
          cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [enabled])
      return state
    },
  }
})

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

vi.mock('@/lib/auth/auth-client', () => ({
  client: {
    getSession: mockGetSession,
    organization: { setActive: mockSetActive },
    signOut: mockSignOut,
  },
  useSession: mockUseSession,
}))

vi.mock('@/app/invite/components', () => ({
  InviteLayout: ({ children }: { children: ReactNode }) => children,
  InviteStatusCard: ({
    actions = [],
    description,
    title,
    type,
  }: {
    actions?: Array<{ label: string; onClick: () => void }>
    description?: ReactNode
    title: string
    type: string
  }) => (
    <>
      <div data-invite-status={type}>{title}</div>
      <div>{description}</div>
      {actions.map((action) => (
        <button key={action.label} type='button' onClick={action.onClick}>
          {action.label}
        </button>
      ))}
    </>
  ),
}))

import Invite from '@/app/invite/[id]/invite'
import { sessionKeys } from '@/hooks/queries/session'

let container: HTMLDivElement
let root: Root
let membershipIntent: 'external' | 'internal'

const EXTERNAL_REFRESHED_SESSION = {
  user: { id: 'user-1', email: 'invitee@example.com' },
  session: { id: 'session-1', userId: 'user-1', activeOrganizationId: 'organization-a' },
}

const INTERNAL_REFRESHED_SESSION = {
  user: { id: 'user-1', email: 'invitee@example.com' },
  session: { id: 'session-1', userId: 'user-1', activeOrganizationId: 'organization-2' },
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderInvite(registrationDisabled = false): Promise<void> {
  act(() => {
    root.render(<Invite registrationDisabled={registrationDisabled} />)
  })
  await flush()
}

async function renderSignedOut(registrationDisabled: boolean): Promise<void> {
  mockUseSession.mockReturnValue({ data: null, isPending: false })
  await renderInvite(registrationDisabled)
}

function actionLabels(): string[] {
  return Array.from(container.querySelectorAll('button'), (button) => button.textContent ?? '')
}

async function clickAction(label: string): Promise<void> {
  const action = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === label
  )
  expect(action).toBeDefined()

  await act(async () => {
    action?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function acceptCurrentInvitation(): Promise<void> {
  await renderInvite()
  await clickAction('Accept Invitation')
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  mockSearchParams.current = new URLSearchParams('token=token-1')
  mockUseSession.mockReturnValue({
    data: { user: { id: 'user-1', email: 'invitee@example.com' } },
    isPending: false,
  })
  membershipIntent = 'external'
  mockCancelQueries.mockResolvedValue(undefined)
  mockGetSession.mockResolvedValue({ data: EXTERNAL_REFRESHED_SESSION })
  mockInvalidateQueries.mockResolvedValue(undefined)
  mockRequestJson.mockImplementation((contract: { method?: string }) => {
    if (contract.method === 'GET') {
      return Promise.resolve({
        invitation: {
          id: 'invitation-1',
          kind: 'workspace',
          email: 'invitee@example.com',
          organizationId: 'organization-2',
          organizationName: 'External Team',
          membershipIntent,
          role: 'admin',
          status: 'pending',
          expiresAt: '2026-07-10T00:00:00.000Z',
          createdAt: '2026-07-09T00:00:00.000Z',
          inviterName: 'Inviter',
          inviterEmail: 'inviter@example.com',
          grants: [
            {
              workspaceId: 'workspace-1',
              workspaceName: 'External Workspace',
              permission: 'admin',
            },
          ],
        },
      })
    }

    return Promise.resolve({
      success: true,
      redirectPath: '/workspace/workspace-1',
      invitation: {
        id: 'invitation-1',
        kind: 'workspace',
        organizationId: 'organization-2',
        acceptedWorkspaceIds: ['workspace-1'],
      },
    })
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('Invite', () => {
  it('refreshes an external acceptance without replacing the viewer organization client-side', async () => {
    await acceptCurrentInvitation()

    expect(mockSetActive).not.toHaveBeenCalled()
    expect(mockGetSession).toHaveBeenCalledWith({
      query: { disableCookieCache: true },
    })
    expect(mockCancelQueries).toHaveBeenCalledWith({
      queryKey: sessionKeys.detail(),
    })
    expect(mockSetQueryData).toHaveBeenCalledWith(sessionKeys.detail(), EXTERNAL_REFRESHED_SESSION)
  })

  it('stores the server-selected active organization after an internal join', async () => {
    membershipIntent = 'internal'
    mockGetSession.mockResolvedValue({ data: INTERNAL_REFRESHED_SESSION })

    await acceptCurrentInvitation()

    expect(mockSetActive).not.toHaveBeenCalled()
    expect(mockSetQueryData).toHaveBeenCalledWith(sessionKeys.detail(), INTERNAL_REFRESHED_SESSION)
  })

  it('keeps acceptance committed and navigation scheduled when all cache refreshes fail', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'Session refresh denied',
        status: 401,
        statusText: 'Unauthorized',
      },
    })
    mockInvalidateQueries.mockRejectedValue(new Error('Cache invalidation failed'))

    await acceptCurrentInvitation()
    await flush()

    expect(container.textContent).toContain('Welcome!')
    expect(container.textContent).not.toContain('Invitation Error')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })

    expect(mockPush).toHaveBeenCalledWith('/workspace/workspace-1')
    expect(mockSetQueryData).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith('Post-acceptance cache refresh failed', {
      cache: 'session',
      error: 'Session refresh denied',
    })
    expect(mockLogger.warn).toHaveBeenCalledTimes(4)
  })

  /**
   * Every case marks the visitor as new (`new=true`), the state that leads with
   * "Create an account" when registration is enabled — so each assertion below
   * fails if the flag stops being honored.
   */
  describe('signed out with registration disabled', () => {
    beforeEach(() => {
      mockSearchParams.current = new URLSearchParams('token=token-1&new=true')
    })

    it('offers only sign-in, since /signup would reject the visitor', async () => {
      await renderSignedOut(true)

      expect(actionLabels()).toEqual(['Sign in', 'Return to Home'])
      expect(container.textContent).toContain('Account creation is disabled on this instance')
    })

    it('sends the visitor to login with the invitation as the callback', async () => {
      await renderSignedOut(true)
      await clickAction('Sign in')

      expect(mockPush).toHaveBeenCalledWith(
        `/login?invite_flow=true&callbackUrl=${encodeURIComponent('/invite/invitation-1?token=token-1')}`
      )
    })

    it('still offers account creation when registration is enabled', async () => {
      await renderSignedOut(false)

      expect(actionLabels()).toEqual([
        'Create an account',
        'I already have an account',
        'Return to Home',
      ])
    })
  })
})
