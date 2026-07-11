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
  mockPush: vi.fn(),
  mockRequestJson: vi.fn(),
  mockSearchParams: {
    get: (key: string) => (key === 'token' ? 'token-1' : null),
  },
  mockSetActive: vi.fn(),
  mockSetQueryData: vi.fn(),
  mockSignOut: vi.fn(),
  mockUseSession: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'invitation-1' }),
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    cancelQueries: mockCancelQueries,
    invalidateQueries: mockInvalidateQueries,
    setQueryData: mockSetQueryData,
  }),
}))

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
    title,
    type,
  }: {
    actions?: Array<{ label: string; onClick: () => void }>
    title: string
    type: string
  }) => (
    <>
      <div data-invite-status={type}>{title}</div>
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

async function acceptCurrentInvitation(): Promise<void> {
  act(() => {
    root.render(<Invite />)
  })
  await flush()

  const acceptButton = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === 'Accept Invitation'
  )
  expect(acceptButton).toBeDefined()

  await act(async () => {
    acceptButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

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

  it('keeps a successful acceptance committed when the session refresh fails', async () => {
    mockGetSession.mockRejectedValueOnce(new Error('Session refresh failed'))

    await acceptCurrentInvitation()
    await flush()

    expect(container.textContent).toContain('Welcome!')
    expect(container.textContent).not.toContain('Invitation Error')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })

    expect(mockPush).toHaveBeenCalledWith('/workspace/workspace-1')
  })
})
