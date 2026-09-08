/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/lib/api/client/errors'
import type { MyInvitation } from '@/lib/api/contracts/invitations'

const {
  mockCancelQueries,
  mockClearUserData,
  mockGetSession,
  mockInvalidateQueries,
  mockLogger,
  mockPush,
  mockRequestJson,
  mockRefetch,
  mockSearchParams,
  mockSetActive,
  mockSetQueryData,
  mockSignOut,
  mockUseSession,
} = vi.hoisted(() => ({
  mockCancelQueries: vi.fn(),
  mockClearUserData: vi.fn(),
  mockGetSession: vi.fn(),
  mockInvalidateQueries: vi.fn(),
  mockLogger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
  mockPush: vi.fn(),
  mockRequestJson: vi.fn(),
  mockRefetch: vi.fn(),
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

vi.mock('@tanstack/react-query', () => {
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
      const [state, setState] = useState<{
        data: unknown
        error: unknown
        isPending: boolean
      }>({ data: undefined, error: null, isPending: true })
      const enabled = options.enabled !== false
      useEffect(() => {
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
      return { ...state, refetch: mockRefetch, isFetching: false }
    },
  }
})

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

vi.mock('@/stores', () => ({ clearUserData: mockClearUserData }))

vi.mock('@/lib/auth/auth-client', () => ({
  client: {
    getSession: mockGetSession,
    organization: { setActive: mockSetActive },
    signOut: mockSignOut,
  },
  useSession: mockUseSession,
}))

vi.mock('@/app/invite/components/layout', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/app/invite/components/status-card', () => ({
  InviteStatusCard: ({
    actions = [],
    description,
    details,
    title,
    type,
  }: {
    actions?: Array<{ label: string; onClick: () => void; disabled?: boolean }>
    description?: ReactNode
    details?: ReactNode
    title: string
    type: string
  }) => (
    <>
      <div data-invite-status={type}>{title}</div>
      <div>{description}</div>
      {details}
      {actions.map((action) => (
        <button
          key={action.label}
          type='button'
          onClick={action.onClick}
          disabled={action.disabled}
        >
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
let joinPreview: MyInvitation['joinPreview']

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
  joinPreview = {
    outcome: 'external',
    organizationName: null,
    workspaceIdsToMove: [],
    workspacesToMove: [],
  }
  mockCancelQueries.mockResolvedValue(undefined)
  mockClearUserData.mockResolvedValue(true)
  mockGetSession.mockResolvedValue({ data: EXTERNAL_REFRESHED_SESSION })
  mockInvalidateQueries.mockResolvedValue(undefined)
  mockRequestJson.mockImplementation((contract: { method?: string }) => {
    if (contract.method === 'GET') {
      return Promise.resolve({
        joinPreview,
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
  it('clears the previous account cache before navigating to the invitation sign-in', async () => {
    mockRequestJson.mockRejectedValue(
      new ApiClientError({
        status: 403,
        message: 'Wrong account',
        body: { error: 'email-mismatch' },
      })
    )
    let completeCleanup: (result: boolean) => void = () => undefined
    mockClearUserData.mockReturnValue(
      new Promise<boolean>((resolve) => {
        completeCleanup = resolve
      })
    )
    await renderInvite()
    expect(container.textContent).toContain('Wrong Account')
    await clickAction('Sign in with a different account')
    expect(mockSignOut).toHaveBeenCalledOnce()
    expect(mockClearUserData).toHaveBeenCalledOnce()
    expect(mockPush).not.toHaveBeenCalled()
    await act(async () => completeCleanup(true))
    expect(mockPush).toHaveBeenCalledWith(
      `/login?invite_flow=true&callbackUrl=${encodeURIComponent('/invite/invitation-1?token=token-1')}`
    )
  })

  it('renders the actual join target and complete migration before echoing that preview', async () => {
    membershipIntent = 'internal'
    joinPreview = {
      outcome: 'will-join',
      organizationName: 'Actual Organization',
      workspacesToMove: ['Personal work', 'Archived project'],
      workspaceIdsToMove: ['personal', 'archived'],
    }
    await renderInvite()
    expect(container.textContent).toContain(
      'You will join Actual Organization as an organization admin'
    )
    expect(container.textContent).toContain('including archived workspaces')
    expect(
      Array.from(
        container.querySelectorAll('[aria-label="Workspaces moving into the organization"] li'),
        (item) => item.textContent
      )
    ).toEqual(['Personal work', 'Archived project'])
    expect(container.textContent).toContain('External Workspace: admin access')
    await clickAction('Accept Invitation')
    expect(mockRequestJson).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST' }), {
      params: { id: 'invitation-1' },
      body: {
        token: 'token-1',
        disclosedWorkspaceIds: ['personal', 'archived'],
        disclosedOutcome: 'will-join',
      },
    })
  })

  it.each([
    ['already-member', 'Your organization role will stay the same'],
    ['external', 'workspace access without joining an organization'],
    ['blocked', 'This invitation cannot currently be accepted'],
  ] as const)('discloses %s without promising a membership change', async (outcome, message) => {
    membershipIntent = 'internal'
    joinPreview = {
      outcome,
      organizationName: null,
      workspaceIdsToMove: [],
      workspacesToMove: [],
    }
    await renderInvite()
    expect(container.textContent).toContain(message)
    expect(container.textContent).not.toContain('as an organization admin')
    await clickAction('Accept Invitation')
    expect(mockRequestJson).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST' }),
      expect.objectContaining({
        body: { token: 'token-1', disclosedWorkspaceIds: [], disclosedOutcome: outcome },
      })
    )
  })

  it('withholds internal acceptance and offers refresh when disclosure is missing', async () => {
    membershipIntent = 'internal'
    joinPreview = null
    await renderInvite()
    expect(container.textContent).toContain('We could not load how this invitation affects')
    const accept = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Accept Invitation'
    )
    expect(accept?.disabled).toBe(true)
    await clickAction('Accept Invitation')
    expect(mockRequestJson).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST' }),
      expect.anything()
    )
    await clickAction('Refresh invitation')
    expect(mockRefetch).toHaveBeenCalledOnce()
  })

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
