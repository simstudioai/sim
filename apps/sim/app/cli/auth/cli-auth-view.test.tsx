/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks Connect until the workspace list resolves', () => {
    // The regression: while pending, the picker falls back to no default, so an
    // early click saved no workspace when the same click a moment later would
    // have saved the user's last active workspace.
    mockUseWorkspaces.mockReturnValue({ isPending: true, isError: false, data: undefined })
    render()

    expect(connectButton().disabled).toBe(true)
    expect(container.textContent).toContain('Loading workspaces')
    expect(container.textContent).not.toContain('No default workspace')
  })

  it('does not present a workspace choice as final while loading', () => {
    mockUseWorkspaces.mockReturnValue({ isPending: true, isError: false, data: undefined })
    render()

    expect(container.textContent).toContain('Loading your workspace options')
    expect(container.textContent).not.toContain('Issues a personal key')
  })

  it('enables Connect and preselects the last active workspace once loaded', () => {
    mockUseWorkspaces.mockReturnValue(LOADED)
    render()

    expect(connectButton().disabled).toBe(false)
    expect(container.textContent).toContain('Acme')
    expect(container.textContent).toContain('personal key')
    expect(container.textContent).toContain('makes Acme the CLI default')
  })

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

  it('still lets the user connect when the workspace list fails', () => {
    // A personal key is degraded but usable; blocking entirely would strand a
    // terminal on a transient list failure.
    mockUseWorkspaces.mockReturnValue({ isPending: false, isError: true, data: undefined })
    render()

    expect(connectButton().disabled).toBe(false)
    expect(container.textContent).toContain('Could not load your workspaces')
  })
})
