/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCaptureEvent, mockSetSearchQuery, mockSetSearchFilters, modeState } = vi.hoisted(
  () => ({
    mockCaptureEvent: vi.fn(),
    mockSetSearchQuery: vi.fn(),
    mockSetSearchFilters: vi.fn(),
    /** The URL `mode` param as the nuqs mock serves it; `set` is the live setter once mounted. */
    modeState: { initial: 'build', set: (_next: string) => {} },
  })
)

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))
vi.mock('nuqs', async () => {
  const { useState } = await import('react')
  return {
    useQueryState: (key: string) => {
      const [mode, setMode] = useState(modeState.initial)
      if (key !== 'mode') return [null, mockSetSearchQuery]
      modeState.set = setMode
      return [mode, setMode]
    },
    useQueryStates: () => [{}, mockSetSearchFilters],
  }
})
vi.mock('posthog-js/react', () => ({ usePostHog: () => null }))
vi.mock('@/lib/posthog/client', () => ({ captureEvent: mockCaptureEvent }))

import { ModeSwitcher } from '@/app/workspace/[workspaceId]/home/components/user-input/components/mode-switcher/mode-switcher'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<ModeSwitcher />))
}

function trigger(): HTMLButtonElement {
  const node = container?.querySelector('button')
  if (!node) throw new Error('Switcher trigger did not render')
  return node
}

/** Opens the menu the way a pointer does — Radix opens on `pointerdown`. */
function openMenu() {
  act(() => {
    trigger().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
  })
}

function items(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
}

function select(index: number) {
  act(() => {
    items()[index].dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
  })
}

beforeEach(() => {
  mockCaptureEvent.mockClear()
  mockSetSearchQuery.mockClear()
  mockSetSearchFilters.mockClear()
  modeState.initial = 'build'
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('ModeSwitcher', () => {
  it('renders the active mode as a label-only round chip and defaults to Build', () => {
    mount()

    const button = trigger()
    expect(button.textContent).toBe('Build')
    expect(button.getAttribute('aria-label')).toBe('Mode: Build')
    expect(button.className).toContain('h-[30px]')
    expect(button.className).toContain('rounded-full')
    expect(button.className).not.toContain('rounded-lg')
    expect(button.className).toContain('hover-hover:bg-[var(--surface-hover)]')
    expect(button.querySelector('svg')).toBeNull()
  })

  it('lists every mode and checks the active one', () => {
    mount()
    openMenu()

    const rows = items()
    expect(rows.map((row) => row.textContent)).toEqual(['Build', 'Search', 'Assistant'])
    expect(rows[0].querySelector('svg')).not.toBeNull()
    expect(rows[1].querySelector('svg')).toBeNull()
    expect(rows[2].querySelector('svg')).toBeNull()
  })

  it('writes the chosen mode to the URL and reports the change', () => {
    mount()
    openMenu()
    select(1)

    expect(trigger().textContent).toBe('Search')
    expect(mockCaptureEvent).toHaveBeenCalledWith(null, 'chat_mode_changed', {
      workspace_id: 'workspace-1',
      mode: 'search',
    })
    expect(mockSetSearchQuery).not.toHaveBeenCalled()
  })

  it('reads the mode from the URL on mount', () => {
    modeState.initial = 'assistant'
    mount()

    expect(trigger().textContent).toBe('Assistant')
    expect(trigger().getAttribute('aria-label')).toBe('Mode: Assistant')
  })

  it('drops the search query from the URL when leaving Search', () => {
    modeState.initial = 'search'
    mount()
    openMenu()
    select(0)

    expect(trigger().textContent).toBe('Build')
    expect(mockSetSearchQuery).toHaveBeenCalledWith(null, { history: 'replace', scroll: false })
    expect(mockSetSearchFilters).toHaveBeenCalledWith(
      { source: null, updated: null },
      { history: 'replace', scroll: false }
    )
  })

  it('does not report re-selecting the active mode', () => {
    mount()
    openMenu()
    select(0)

    expect(trigger().textContent).toBe('Build')
    expect(mockCaptureEvent).not.toHaveBeenCalled()
  })
})
