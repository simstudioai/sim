/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

const { mockApprove, mockUseWorkspaces, mockPush } = vi.hoisted(() => ({
  mockApprove: vi.fn(),
  mockUseWorkspaces: vi.fn(),
  mockPush: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('nuqs', () => ({
  useQueryStates: () => [
    {
      request: 'a'.repeat(43),
      challenge: 'b'.repeat(43),
      pairing: 'ABCD-2345',
      scope: 'platform',
      workspace: null,
    },
  ],
}))

vi.mock('@/hooks/queries/cli-auth', () => ({
  useApproveCliAuth: () => ({
    mutate: mockApprove,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
}))

vi.mock('@/hooks/queries/workspace', () => ({
  useWorkspacesWithMetadata: mockUseWorkspaces,
}))

import { CliAuthView } from '@/app/cli/auth/cli-auth-view'

let container: HTMLDivElement
let root: Root

function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<CliAuthView />)
  })
}

/** The primary CTA is the only button whose label mentions connecting. */
function connectButton(): HTMLButtonElement {
  const buttons = [...container.querySelectorAll('button')] as HTMLButtonElement[]
  const button = buttons.find((b) => /connect/i.test(b.textContent ?? ''))
  if (!button) throw new Error('Connect button not found')
  return button
}

const LOADED = {
  isPending: false,
  isError: false,
  data: {
    workspaces: [
      { id: 'ws_admin', name: 'Acme', permissions: 'admin' },
      { id: 'ws_member', name: 'Other', permissions: 'write' },
    ],
    lastActiveWorkspaceId: 'ws_admin',
  },
}

describe('CliAuthView workspace loading', () => {
  it('issues a personal key even when the approver is a workspace admin', () => {
    mockUseWorkspaces.mockReturnValue(LOADED)
    render()
    act(() => {
      connectButton().click()
    })

    expect(mockApprove).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'platform',
        workspaceId: 'ws_admin',
        bindKeyToWorkspace: false,
      }),
      expect.anything()
    )
  })
})
