/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResourceRow } from './resource-row'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(ui: ReactNode): HTMLElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(ui))
  return container
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('ResourceRow', () => {
  it('keeps trailing controls interactive without nesting them inside the row button', () => {
    const onOpen = vi.fn()
    const onMenu = vi.fn()
    const view = mount(
      <ResourceRow
        title='Server'
        description='Connected'
        onClick={onOpen}
        clickLabel='Open server'
        trailing={
          <button type='button' onClick={onMenu}>
            Actions
          </button>
        }
      />
    )
    const rowButton = view.querySelector<HTMLButtonElement>('button[aria-label="Open server"]')
    const menuButton = view.querySelector<HTMLButtonElement>('button:not([aria-label])')
    expect(rowButton?.contains(menuButton ?? null)).toBe(false)
    expect(rowButton?.getAttribute('aria-describedby')).toBe(view.querySelector('span[id]')?.id)
    act(() => menuButton?.click())
    expect(onMenu).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
    act(() => rowButton?.click())
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('delegates route links to a caller renderer without losing native link attributes', () => {
    const renderLink = vi.fn((props: React.ComponentProps<'a'>) => <a {...props} />)
    const view = mount(
      <ResourceRow
        title='Files'
        href='/files'
        clickLabel='Open files'
        navigable
        renderLink={renderLink}
      />
    )
    const link = view.querySelector('a')
    expect(renderLink).toHaveBeenCalledTimes(1)
    expect(link?.getAttribute('href')).toBe('/files')
    expect(link?.getAttribute('aria-label')).toBe('Open files')
    expect(view.querySelectorAll('svg')).toHaveLength(1)
  })

  it('removes the activation target when disabled while retaining row content', () => {
    const view = mount(<ResourceRow title='Files' href='/files' clickLabel='Open files' disabled />)
    expect(view.querySelector('a, button')).toBeNull()
    expect(view.textContent).toContain('Files')
  })
})
