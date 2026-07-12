/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsMac } = vi.hoisted(() => ({ mockIsMac: vi.fn(() => false) }))
vi.mock('@/lib/core/utils/platform', () => ({ isMacPlatform: mockIsMac }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import {
  GlobalCommandsProvider,
  useRegisterGlobalCommands,
} from '@/app/workspace/[workspaceId]/providers/global-commands-provider'

function RegisterModK({ handler }: { handler: () => void }) {
  useRegisterGlobalCommands([{ id: 'search', shortcut: 'Mod+K', handler }])
  return null
}

function RegisterModKOutsideEditable({ handler }: { handler: () => void }) {
  useRegisterGlobalCommands([{ id: 'search', shortcut: 'Mod+K', handler, allowInEditable: false }])
  return null
}

let container: HTMLDivElement
let root: Root

function mount(ui: ReactNode) {
  act(() => {
    root.render(ui)
  })
}

/** Non-mac (mocked): `Mod` resolves to Ctrl, so Ctrl+K matches a `Mod+K` shortcut. */
function pressModK() {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })
  )
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('GlobalCommandsProvider owned-shortcut yielding', () => {
  it('fires a global command when nothing owns the shortcut', () => {
    const handler = vi.fn()
    mount(
      <GlobalCommandsProvider>
        <RegisterModK handler={handler} />
      </GlobalCommandsProvider>
    )
    pressModK()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('yields the shortcut to a focused element that declares it owns it', () => {
    const handler = vi.fn()
    mount(
      <GlobalCommandsProvider>
        <RegisterModK handler={handler} />
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: focusable stand-in for the editor */}
        <div data-owned-shortcuts='Mod+K' tabIndex={0} />
      </GlobalCommandsProvider>
    )
    ;(container.querySelector('[data-owned-shortcuts]') as HTMLElement).focus()
    pressModK()
    expect(handler).not.toHaveBeenCalled()
  })

  it('still fires when the focused element owns only a different shortcut', () => {
    const handler = vi.fn()
    mount(
      <GlobalCommandsProvider>
        <RegisterModK handler={handler} />
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: focusable stand-in for the editor */}
        <div data-owned-shortcuts='Mod+B' tabIndex={0} />
      </GlobalCommandsProvider>
    )
    ;(container.querySelector('[data-owned-shortcuts]') as HTMLElement).focus()
    pressModK()
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

describe('GlobalCommandsProvider editable guard', () => {
  /**
   * jsdom does not implement `isContentEditable`, so stub the browser's computed
   * editability on the element the test focuses.
   */
  function focusWithEditability(element: HTMLElement, isContentEditable: boolean) {
    Object.defineProperty(element, 'isContentEditable', { value: isContentEditable })
    element.focus()
  }

  it('skips a non-editable command when focus is in an input', () => {
    const handler = vi.fn()
    mount(
      <GlobalCommandsProvider>
        <RegisterModKOutsideEditable handler={handler} />
        <input type='text' />
      </GlobalCommandsProvider>
    )
    ;(container.querySelector('input') as HTMLInputElement).focus()
    pressModK()
    expect(handler).not.toHaveBeenCalled()
  })

  it('skips a non-editable command when focus is in a contenteditable element', () => {
    const handler = vi.fn()
    mount(
      <GlobalCommandsProvider>
        <RegisterModKOutsideEditable handler={handler} />
        <div contentEditable />
      </GlobalCommandsProvider>
    )
    focusWithEditability(container.querySelector('[contenteditable]') as HTMLElement, true)
    pressModK()
    expect(handler).not.toHaveBeenCalled()
  })

  it('skips a non-editable command when focus is on a descendant of a contenteditable root', () => {
    const handler = vi.fn()
    mount(
      <GlobalCommandsProvider>
        <RegisterModKOutsideEditable handler={handler} />
        <div contentEditable>
          <span tabIndex={0} />
        </div>
      </GlobalCommandsProvider>
    )
    focusWithEditability(container.querySelector('span') as HTMLElement, true)
    pressModK()
    expect(handler).not.toHaveBeenCalled()
  })

  it('fires a non-editable command when focus is in a contenteditable="false" element', () => {
    const handler = vi.fn()
    mount(
      <GlobalCommandsProvider>
        <RegisterModKOutsideEditable handler={handler} />
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: focusable stand-in for a read-only editor */}
        <div contentEditable={false} tabIndex={0} />
      </GlobalCommandsProvider>
    )
    focusWithEditability(container.querySelector('[contenteditable]') as HTMLElement, false)
    pressModK()
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
