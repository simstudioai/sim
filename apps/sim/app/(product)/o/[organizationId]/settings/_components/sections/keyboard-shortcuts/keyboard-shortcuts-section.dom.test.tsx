/**
 * @vitest-environment jsdom
 *
 * The Keyboard shortcuts page. Failure mode: a shortcut the product registers (Mod+B, the workflow
 * editor's commands) missing from the page, as they were while it was a hand-written list.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import KeyboardShortcutsSection from '@/app/(product)/o/[organizationId]/settings/_components/sections/keyboard-shortcuts/keyboard-shortcuts-section'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root.render(<KeyboardShortcutsSection />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function listedKeys() {
  return [...container.querySelectorAll('kbd')].map((key) => key.textContent)
}

it('lists Toggle sidebar and the workflow editor commands', () => {
  expect(container.textContent).toContain('Toggle sidebar')
  expect(listedKeys()).toEqual(
    expect.arrayContaining([
      '⌘ / Ctrl + B',
      '⌘ / Ctrl + L',
      '⌘ / Ctrl + Shift + P',
      '⌘ / Ctrl + Shift + A',
      '⌘ / Ctrl + F',
      '⌘ / Ctrl + ⌥ / Alt + F',
      '⌘ / Ctrl + Shift + F',
      '⌘ / Ctrl + Enter',
      '⌘ / Ctrl + D',
    ])
  )
})
