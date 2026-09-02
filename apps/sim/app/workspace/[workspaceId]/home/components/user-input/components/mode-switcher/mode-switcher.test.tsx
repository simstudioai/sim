/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCaptureEvent, mockSetSearchQuery, mockSetSearchFilters } = vi.hoisted(() => ({
  mockCaptureEvent: vi.fn(),
  mockSetSearchQuery: vi.fn(),
  mockSetSearchFilters: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))
vi.mock('nuqs', () => ({
  useQueryState: () => [null, mockSetSearchQuery],
  useQueryStates: () => [{}, mockSetSearchFilters],
}))
vi.mock('posthog-js/react', () => ({ usePostHog: () => null }))
vi.mock('@/lib/posthog/client', () => ({ captureEvent: mockCaptureEvent }))

import { ModeSwitcher } from '@/app/workspace/[workspaceId]/home/components/user-input/components/mode-switcher/mode-switcher'
import { useMothershipModeStore } from '@/stores/mothership-mode/store'

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

beforeEach(() => {
  mockCaptureEvent.mockClear()
  useMothershipModeStore.getState().reset()
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
    expect(rows.map((row) => row.textContent)).toEqual(['Build', 'Ask', 'Search'])
    expect(rows[0].querySelector('svg')).not.toBeNull()
    expect(rows[1].querySelector('svg')).toBeNull()
    expect(rows[2].querySelector('svg')).toBeNull()
  })

  it('switches the shared mode and reports the change', () => {
    mount()
    openMenu()

    act(() => {
      items()[2].dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    })

    expect(useMothershipModeStore.getState().mode).toBe('search')
    expect(trigger().textContent).toBe('Search')
    expect(mockCaptureEvent).toHaveBeenCalledWith(null, 'chat_mode_changed', {
      workspace_id: 'workspace-1',
      mode: 'search',
    })
    expect(mockSetSearchQuery).not.toHaveBeenCalled()
  })

  it('drops the search query from the URL when leaving Search', () => {
    useMothershipModeStore.getState().setMode('search')
    mount()
    openMenu()

    act(() => {
      items()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    })

    expect(useMothershipModeStore.getState().mode).toBe('build')
    expect(mockSetSearchQuery).toHaveBeenCalledWith(null, { history: 'replace', scroll: false })
    expect(mockSetSearchFilters).toHaveBeenCalledWith(
      { source: null, updated: null },
      { history: 'replace', scroll: false }
    )
  })

  it('does not report re-selecting the active mode', () => {
    mount()
    openMenu()

    act(() => {
      items()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    })

    expect(useMothershipModeStore.getState().mode).toBe('build')
    expect(mockCaptureEvent).not.toHaveBeenCalled()
  })
})
