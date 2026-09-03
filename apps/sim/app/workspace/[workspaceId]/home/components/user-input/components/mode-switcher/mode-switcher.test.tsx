/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCaptureEvent, mockLeaveSearch } = vi.hoisted(() => ({
  mockCaptureEvent: vi.fn(),
  mockLeaveSearch: vi.fn(),
}))
const mockUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))
vi.mock('posthog-js/react', () => ({ usePostHog: () => null }))
vi.mock('@/lib/posthog/client', () => ({ captureEvent: mockCaptureEvent }))

import { ModeSwitcher } from '@/app/workspace/[workspaceId]/home/components/user-input/components/mode-switcher/mode-switcher'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(searchParams = '') {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={mockUrlUpdate}>
        <ModeSwitcher onLeaveSearch={mockLeaveSearch} />
      </NuqsTestingAdapter>
    )
  )
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

async function select(index: number) {
  await act(async () => {
    items()[index].dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    await vi.advanceTimersByTimeAsync(1)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  mockCaptureEvent.mockClear()
  mockLeaveSearch.mockClear()
  mockUrlUpdate.mockClear()
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.useRealTimers()
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

  it('writes the chosen mode to the URL and reports the change', async () => {
    mount()
    openMenu()
    await select(1)

    expect(trigger().textContent).toBe('Search')
    expect(mockCaptureEvent).toHaveBeenCalledWith(null, 'chat_mode_changed', {
      workspace_id: 'workspace-1',
      mode: 'search',
    })
    expect(mockUrlUpdate.mock.lastCall?.[0].searchParams.get('mode')).toBe('search')
    expect(mockLeaveSearch).not.toHaveBeenCalled()
  })

  it('reads the mode from the URL on mount', () => {
    mount('?mode=assistant')

    expect(trigger().textContent).toBe('Assistant')
    expect(trigger().getAttribute('aria-label')).toBe('Mode: Assistant')
  })

  it('clears the composer and search parameters together when leaving Search', async () => {
    mount('?mode=search&q=budget&source=upload&updated=7d&resource=report')
    openMenu()
    await select(0)

    expect(trigger().textContent).toBe('Build')
    expect(mockLeaveSearch).toHaveBeenCalledOnce()
    expect(mockUrlUpdate).toHaveBeenCalledOnce()
    expect(mockUrlUpdate.mock.lastCall?.[0].searchParams.toString()).toBe('resource=report')
    expect(mockUrlUpdate.mock.lastCall?.[0].options).toMatchObject({
      history: 'replace',
      scroll: false,
    })
    expect(mockLeaveSearch.mock.invocationCallOrder[0]).toBeLessThan(
      mockUrlUpdate.mock.invocationCallOrder[0]
    )
  })

  it('does not report re-selecting the active mode', async () => {
    mount()
    openMenu()
    await select(0)

    expect(trigger().textContent).toBe('Build')
    expect(mockCaptureEvent).not.toHaveBeenCalled()
    expect(mockLeaveSearch).not.toHaveBeenCalled()
  })
})
