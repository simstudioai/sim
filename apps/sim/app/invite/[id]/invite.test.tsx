/**
 * @vitest-environment jsdom
 */

import { act, type ReactNode, useEffect, useState } from 'react'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { reactQueryMock, reactQueryMockFns } from '@sim/testing/mocks/react-query.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/lib/api/client/errors'
import type { MyInvitation } from '@/lib/api/contracts/invitations'

const { mockClearUserData } = vi.hoisted(() => ({
  mockClearUserData: vi.fn(),
}))

vi.mock('next/navigation', () => nextNavigationMock)

vi.mock('@tanstack/react-query', () => reactQueryMock)

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)

vi.mock('@/stores', () => ({ clearUserData: mockClearUserData }))

vi.mock('@/lib/auth/auth-client', () => authClientMock)

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

const mockPush = nextNavigationMockFns.router.push
nextNavigationMockFns.mockUseParams.mockReturnValue({ id: 'invitation-1' })

const mockRequestJson = apiClientRequestMockFns.mockRequestJson
const {
  cancelQueries: mockCancelQueries,
  invalidateQueries: mockInvalidateQueries,
  setQueryData: mockSetQueryData,
} = reactQueryMockFns.mockQueryClient
const { mockUseSession, mockSignOut } = authClientMockFns
const {
  getSession: mockGetSession,
  organization: { setActive: mockSetActive },
} = authClientMockFns.mockClient
const mockRefetch = vi.fn()

/**
 * Minimal useQuery stand-in: runs the queryFn once when enabled and
 * exposes { data, error, isPending } — enough for the invitation fetch.
 */
reactQueryMockFns.mockUseQuery.mockImplementation(
  (options: {
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
    }, [enabled])
    return { ...state, refetch: mockRefetch, isFetching: false }
  }
)

let container: HTMLDivElement
let root: Root
let membershipIntent: 'external' | 'internal'
let joinPreview: MyInvitation['joinPreview']

const EXTERNAL_REFRESHED_SESSION = {
  user: { id: 'user-1', email: 'invitee@example.com' },
  session: { id: 'session-1', userId: 'user-1', activeOrganizationId: 'organization-a' },
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

  nextNavigationMockFns.mockUseSearchParams.mockReturnValue(new URLSearchParams('token=token-1'))
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
})

describe('Invite', () => {
  it.each(['internal', 'external'] as const)(
    'offers an account switch to a token holder who is not the %s invitee',
    async (intent) => {
      membershipIntent = intent
      joinPreview = null
      mockUseSession.mockReturnValue({
        data: { user: { id: 'other-user', email: 'other@example.com' } },
        isPending: false,
      })
      await renderInvite()

      expect(container.textContent).toContain('Wrong Account')
      expect(container.textContent).not.toContain('We could not load how this invitation affects')
      expect(actionLabels()).not.toContain('Accept Invitation')
      expect(actionLabels()).not.toContain('Refresh invitation')
      expect(mockRequestJson).not.toHaveBeenCalledWith(
        expect.objectContaining({ method: 'POST' }),
        expect.anything()
      )
      await clickAction('Sign in with a different account')
      expect(mockSignOut).toHaveBeenCalledOnce()
      expect(mockClearUserData).toHaveBeenCalledOnce()
      expect(mockPush).toHaveBeenCalledWith(
        `/login?invite_flow=true&callbackUrl=${encodeURIComponent('/invite/invitation-1?token=token-1')}`
      )
    }
  )

  it('matches the invitation email with the same normalization as the server', async () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: 'user-1', email: ' INVITEE@EXAMPLE.COM ' } },
      isPending: false,
    })
    await renderInvite()

    expect(container.textContent).not.toContain('Wrong Account')
    expect(actionLabels()).toContain('Accept Invitation')
  })

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
})
