/**
 * @vitest-environment jsdom
 *
 * Mod+B and Mod+K reach the shell from the keyboard on the web and from the native menu on
 * desktop. Failure modes: the desktop menu's Toggle Sidebar firing while the reader types in a
 * field (where Mod+B is the field's own binding) or with a modal open, and its Search opening
 * command search over another modal. The web path already refused all three.
 */
import { act, useRef } from 'react'
import type { DesktopCommand } from '@sim/desktop-bridge'
import { stubDialog } from '@sim/testing/mocks/browser-apis.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useShellShortcuts } from '@/app/(product)/_components/platform-shell/shell-shortcuts'

const toggleSidebar = vi.fn()
const toggleCommand = vi.fn()
let sendCommand: (command: DesktopCommand) => void = () => {}
let container: HTMLDivElement
let root: Root

function Shell() {
  const drawer = useRef<HTMLDialogElement>(null)
  useShellShortcuts({ drawer, toggleSidebar, toggleCommand })
  return (
    <>
      <input aria-label='Name' />
      <button type='button'>Plain</button>
      <dialog aria-label='Confirm'>
        <button type='button'>Inside</button>
      </dialog>
    </>
  )
}

const nativeClosest = Element.prototype.closest

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubDialog()
  // jsdom has no `:modal`; a dialog `showModal` opened is the modal one.
  vi.spyOn(Element.prototype, 'closest').mockImplementation(function (
    this: Element,
    selector: string
  ) {
    return nativeClosest.call(this, selector === 'dialog:modal' ? 'dialog[open]' : selector)
  })
  toggleSidebar.mockClear()
  toggleCommand.mockClear()
  vi.stubGlobal('simDesktop', {
    onCommand: (listener: (command: DesktopCommand) => void) => {
      sendCommand = listener
      return () => {
        sendCommand = () => {}
      }
    },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root.render(<Shell />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function focus(selector: string) {
  container.querySelector<HTMLElement>(selector)?.focus()
}

/** A modal dialog, as `showModal` leaves it, holding the focus. */
function openModal() {
  container.querySelector('dialog')?.showModal()
  focus('dialog button')
}

it('toggles the sidebar and command search from the desktop menu on a plain page', () => {
  focus('button')
  act(() => sendCommand('toggle-sidebar'))
  act(() => sendCommand('open-search'))
  expect(toggleSidebar).toHaveBeenCalledTimes(1)
  expect(toggleCommand).toHaveBeenCalledWith(true)
})

it('leaves Mod+B to a focused field when the desktop menu sends Toggle Sidebar', () => {
  focus('input')
  act(() => sendCommand('toggle-sidebar'))
  expect(toggleSidebar).not.toHaveBeenCalled()
})

it('opens neither the sidebar nor command search over a modal from the desktop menu', () => {
  openModal()
  act(() => sendCommand('toggle-sidebar'))
  act(() => sendCommand('open-search'))
  expect(toggleSidebar).not.toHaveBeenCalled()
  expect(toggleCommand).toHaveBeenCalledWith(false)
})

it('leaves a Mod+K a focused control already claimed, such as the terminal’s clear', () => {
  const input = container.querySelector('input')
  input?.addEventListener('keydown', (event) => event.preventDefault())
  input?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true })
  )
  expect(toggleCommand).not.toHaveBeenCalled()
})
