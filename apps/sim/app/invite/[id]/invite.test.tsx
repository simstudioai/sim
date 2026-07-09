/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockInvalidateQueries,
  mockPush,
  mockRequestJson,
  mockSearchParams,
  mockSetActive,
  mockSignOut,
  mockUseSession,
} = vi.hoisted(() => ({
  mockInvalidateQueries: vi.fn(),
  mockPush: vi.fn(),
  mockRequestJson: vi.fn(),
  mockSearchParams: {
    get: (key: string) => (key === 'token' ? 'token-1' : null),
  },
  mockSetActive: vi.fn(),
  mockSignOut: vi.fn(),
  mockUseSession: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'invitation-1' }),
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

vi.mock('@/lib/auth/auth-client', () => ({
  client: {
    organization: { setActive: mockSetActive },
    signOut: mockSignOut,
  },
  useSession: mockUseSession,
}))

vi.mock('@/app/invite/components', () => ({
  InviteLayout: ({ children }: { children: ReactNode }) => children,
  InviteStatusCard: ({
    actions = [],
  }: {
    actions?: Array<{ label: string; onClick: () => void }>
  }) => (
    <>
      {actions.map((action) => (
        <button key={action.label} type='button' onClick={action.onClick}>
          {action.label}
        </button>
      ))}
    </>
  ),
}))

import Invite from '@/app/invite/[id]/invite'

let container: HTMLDivElement
let root: Root

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
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
          membershipIntent: 'external',
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
  it('does not replace the active organization after accepting an external workspace invite', async () => {
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

    expect(mockSetActive).not.toHaveBeenCalled()
  })
})
