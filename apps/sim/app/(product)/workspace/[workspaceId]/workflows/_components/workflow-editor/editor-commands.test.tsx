/**
 * @vitest-environment jsdom
 *
 * The editor's shortcuts and its block-error chat handoff. Failure modes: shortcuts the command list
 * and canvas menu advertise doing nothing in the editor, a viewer without edit access creating a
 * workflow, and a block error's "Fix in Chat" offered where chat is withheld.
 */
import { act } from 'react'
import { terminalConsoleMockFns } from '@sim/testing/mocks/terminal-console.mock'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { surface } = vi.hoisted(() => ({
  surface: {
    organization: { id: 'org-1' },
    routePrefix: '/o/org-1',
    mothershipAvailable: true,
  },
}))

vi.mock('next/font/local', () => ({ default: () => ({ className: '', style: {} }) }))
vi.mock('@/platform/lib/data/organization', () => ({ useOrganization: () => surface }))

import { ADD_BLOCK_EVENT } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-canvas/add-block-event'
import { GlobalCommandsProvider } from '@/app/(product)/_components/workspace/workflows/global-commands/global-commands'
import {
  BlockErrorChatHandoff,
  EditorShortcuts,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/workflow-editor/editor-commands'

const mounted: Root[] = []
const router = {
  bfcacheId: 'test',
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}
const setChatHandoff = vi.fn()

function render(children: React.ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.createElement('div'))
  mounted.push(root)
  act(() =>
    root.render(
      <AppRouterContext.Provider value={router}>
        <GlobalCommandsProvider>{children}</GlobalCommandsProvider>
      </AppRouterContext.Provider>
    )
  )
}

function press(key: string, shift = false) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: shift, bubbles: true })
    )
  })
}

beforeEach(() => {
  surface.mothershipAvailable = true
  window.localStorage.clear()
  terminalConsoleMockFns.mockUseTerminalConsoleStore.getState.mockReturnValue({ setChatHandoff })
})

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount())
})

describe('EditorShortcuts', () => {
  it('adds an Agent block on Mod+Shift+A', () => {
    const added: unknown[] = []
    const listen = (event: Event) => added.push((event as CustomEvent).detail)
    window.addEventListener(ADD_BLOCK_EVENT, listen)
    try {
      render(<EditorShortcuts workspaceId='ws-1' canEdit onNewWorkflow={vi.fn()} />)
      press('A', true)
    } finally {
      window.removeEventListener(ADD_BLOCK_EVENT, listen)
    }

    expect(added).toEqual([{ type: 'agent', enableTriggerMode: false }])
  })

  it("opens the workspace's logs on Mod+L", () => {
    render(<EditorShortcuts workspaceId='ws-1' canEdit onNewWorkflow={vi.fn()} />)
    press('l')

    expect(router.push).toHaveBeenCalledWith('/workspace/ws-1/logs')
  })

  it('creates a workflow on Mod+Shift+P only for an editor', () => {
    const create = vi.fn()
    render(<EditorShortcuts workspaceId='ws-1' canEdit={false} onNewWorkflow={create} />)
    press('P', true)
    expect(create).not.toHaveBeenCalled()

    for (const root of mounted.splice(0)) act(() => root.unmount())
    render(<EditorShortcuts workspaceId='ws-1' canEdit onNewWorkflow={create} />)
    press('P', true)
    expect(create).toHaveBeenCalledOnce()
  })
})

describe('BlockErrorChatHandoff', () => {
  it("routes a block error's Fix in Chat to a new chat", () => {
    render(<BlockErrorChatHandoff />)
    const handOff = setChatHandoff.mock.calls[0]?.[0] as ((message: string) => void) | undefined
    handOff?.('Model refused')

    expect(router.push).toHaveBeenCalledWith('/o/org-1/chat')
    expect(JSON.parse(window.localStorage.getItem('sim_mothership_handoff') ?? '{}')).toMatchObject(
      { message: 'Model refused', organizationId: 'org-1' }
    )
  })

  it('offers nothing where the viewer cannot start a chat', () => {
    surface.mothershipAvailable = false
    render(<BlockErrorChatHandoff />)

    expect(setChatHandoff).not.toHaveBeenCalled()
  })
})
