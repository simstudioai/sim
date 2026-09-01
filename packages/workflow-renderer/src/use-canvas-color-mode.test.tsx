/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { useCanvasColorMode } from './use-canvas-color-mode'

const roots = new Set<Root>()
const hosts = new Set<HTMLDivElement>()

function ColorModeProbe() {
  return <span data-color-mode={useCanvasColorMode()} />
}

function createHost() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.add(host)
  return host
}

afterEach(() => {
  act(() => {
    for (const root of roots) root.unmount()
  })
  roots.clear()
  for (const host of hosts) host.remove()
  hosts.clear()
  document.documentElement.className = ''
})

describe('useCanvasColorMode', () => {
  it('tracks the document theme class', async () => {
    const host = createHost()
    const root = createRoot(host)
    roots.add(root)

    act(() => root.render(<ColorModeProbe />))
    expect(host.querySelector('span')).toHaveAttribute('data-color-mode', 'light')

    await act(async () => {
      document.documentElement.classList.add('dark')
      await Promise.resolve()
    })
    expect(host.querySelector('span')).toHaveAttribute('data-color-mode', 'dark')
  })

  it('hydrates from a stable light server snapshot before adopting dark mode', async () => {
    document.documentElement.classList.add('dark')
    const host = createHost()
    host.innerHTML = renderToString(<ColorModeProbe />)
    expect(host.querySelector('span')).toHaveAttribute('data-color-mode', 'light')

    await act(async () => {
      roots.add(hydrateRoot(host, <ColorModeProbe />))
      await Promise.resolve()
    })
    expect(host.querySelector('span')).toHaveAttribute('data-color-mode', 'dark')
  })
})
