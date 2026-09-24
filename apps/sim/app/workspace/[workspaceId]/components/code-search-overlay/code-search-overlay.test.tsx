/**
 * @vitest-environment jsdom
 */
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CodeSearchOverlay,
  type CodeSearchOverlayProps,
} from '@/app/workspace/[workspaceId]/components/code-search-overlay/code-search-overlay'

let host: HTMLDivElement
let root: Root
const inputRef = createRef<HTMLInputElement>()

const callbacks = {
  onQueryChange: vi.fn(),
  onPrevious: vi.fn(),
  onNext: vi.fn(),
  onClose: vi.fn(),
}
const parentClick = vi.fn()

function renderOverlay(props: Partial<CodeSearchOverlayProps> = {}) {
  act(() =>
    root.render(
      <div onClick={parentClick}>
        <CodeSearchOverlay
          className='top-0 right-0'
          inputKind='chip'
          inputRef={inputRef}
          query='error'
          matchCount={3}
          currentMatchIndex={1}
          {...callbacks}
          {...props}
        />
      </div>
    )
  )
  const overlay = host.firstElementChild?.firstElementChild as HTMLDivElement
  const input = overlay.querySelector('input') as HTMLInputElement
  return { overlay, input }
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('CodeSearchOverlay', () => {
  it('shares the floating chrome and routes query, navigation, and close actions', () => {
    const { overlay, input } = renderOverlay()
    expect(overlay.className).toContain('h-[34px]')
    expect(overlay.className).toContain('rounded-sm bg-[var(--surface-1)]')
    expect(overlay.className).toContain('top-0 right-0')
    expect(overlay.getAttribute('role')).toBe('presentation')
    expect(inputRef.current).toBe(input)
    expect(input.getAttribute('aria-label')).toBe('Search code')
    expect(input.value).toBe('error')
    expect(overlay.textContent).toContain('2/3')

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    act(() => {
      setter?.call(input, 'failed')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(callbacks.onQueryChange).toHaveBeenCalledWith('failed')
    act(() => {
      overlay.querySelector<HTMLButtonElement>('[aria-label="Previous match"]')?.click()
      overlay.querySelector<HTMLButtonElement>('[aria-label="Next match"]')?.click()
      overlay.querySelector<HTMLButtonElement>('[aria-label="Close search"]')?.click()
    })
    expect(callbacks.onPrevious).toHaveBeenCalledTimes(1)
    expect(callbacks.onNext).toHaveBeenCalledTimes(1)
    expect(callbacks.onClose).toHaveBeenCalledTimes(1)
    expect(parentClick).not.toHaveBeenCalled()
  })

  it('retains the attached terminal edge, marker, wider tally, and disabled navigation', () => {
    const { overlay, input } = renderOverlay({
      appearance: 'attached',
      inputKind: 'plain',
      className: 'top-[30px] right-[8px]',
      query: '',
      matchCount: 0,
      currentMatchIndex: 0,
    })
    expect(overlay.className).toContain('rounded-b-[4px] border-t-0 bg-[var(--bg)]')
    expect(overlay.getAttribute('data-toolbar-root')).toBe('true')
    expect(overlay.getAttribute('data-search-active')).toBe('true')
    expect(overlay.hasAttribute('role')).toBe(false)
    expect(input.parentElement?.className).toContain('h-[23px]')
    expect(input.parentElement?.className).toContain('w-[94px]')
    expect(input.className).toContain('text-caption')
    expect(overlay.textContent).toContain('No results')
    expect(overlay.querySelector('span.w-\\[58px\\]')).not.toBeNull()
    const previous = overlay.querySelector<HTMLButtonElement>('[aria-label="Previous match"]')
    const next = overlay.querySelector<HTMLButtonElement>('[aria-label="Next match"]')
    const close = overlay.querySelector<HTMLButtonElement>('[aria-label="Close search"]')
    expect(previous?.disabled).toBe(true)
    expect(next?.disabled).toBe(true)
    expect(close?.disabled).toBe(false)
    expect(previous?.className).toContain('-m-1.5')
    expect(previous?.querySelector('svg')?.getAttribute('class')).toContain('size-[14px]')
    act(() => {
      previous?.click()
      next?.click()
      close?.click()
    })
    expect(callbacks.onPrevious).not.toHaveBeenCalled()
    expect(callbacks.onNext).not.toHaveBeenCalled()
    expect(callbacks.onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the compact no-results tally for other code panels', () => {
    const { overlay } = renderOverlay({ matchCount: 0, currentMatchIndex: 0 })
    expect(overlay.textContent).toContain('0/0')
    expect(overlay.getAttribute('data-toolbar-root')).toBeNull()
    expect(
      overlay.querySelector<HTMLButtonElement>('[aria-label="Previous match"]')?.disabled
    ).toBe(true)
  })
})
