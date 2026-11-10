/**
 * @vitest-environment jsdom
 *
 * Mod+K inside the chat terminal clears it. Failure mode: the key also reaching the product shell
 * unclaimed, so command search opens over the terminal the reader just cleared.
 */
import { act } from 'react'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useTerminalView } from '@/platform/lib/data/terminal-panel'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    }))
  )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function Terminal() {
  const view = useTerminalView({
    terminalId: 'term-1',
    scopeId: 'scope-1',
    onscreen: false,
    appearanceTheme: 'default',
    defaultZoom: 100,
    focusRequest: 0,
  })
  return <div ref={view.hostRef} />
}

it('claims Mod+K when it clears the terminal, so the shell does not also act on it', async () => {
  act(() => root.render(<Terminal />))
  const input = container.querySelector('textarea')
  expect(input).not.toBeNull()
  const seenByShell: boolean[] = []
  const shell = (event: KeyboardEvent) => seenByShell.push(event.defaultPrevented)
  document.addEventListener('keydown', shell)
  try {
    for (const metaKey of [true, false])
      input?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'k',
          metaKey,
          ctrlKey: !metaKey,
          bubbles: true,
          cancelable: true,
        })
      )
  } finally {
    document.removeEventListener('keydown', shell)
  }
  expect(seenByShell).toEqual([true, true])
})
