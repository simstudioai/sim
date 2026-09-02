/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCaptureEvent } = vi.hoisted(() => ({ mockCaptureEvent: vi.fn() }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))
vi.mock('posthog-js/react', () => ({ usePostHog: () => null }))
vi.mock('@/lib/posthog/client', () => ({ captureEvent: mockCaptureEvent }))

import { SourcesModeToggle } from '@/app/workspace/[workspaceId]/home/components/user-input/components/sources-mode-toggle/sources-mode-toggle'
import { useMothershipModeStore } from '@/stores/mothership-mode/store'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<SourcesModeToggle />))
}

function radios(): HTMLButtonElement[] {
  return Array.from(container?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])
}

function click(radio: HTMLButtonElement) {
  act(() => {
    radio.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
  })
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

describe('SourcesModeToggle', () => {
  it('renders nothing outside Sources mode', () => {
    mount()
    expect(radios()).toHaveLength(0)
  })

  it('names both choices with Search selected by default, and switches to Assistant on click', () => {
    useMothershipModeStore.getState().setMode('search')
    mount()

    expect(radios().map((radio) => radio.textContent)).toEqual(['Search', 'Assistant'])
    expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual(['true', 'false'])

    click(radios()[1])

    expect(useMothershipModeStore.getState().assistant).toBe(true)
    expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true'])
    expect(mockCaptureEvent).toHaveBeenCalledWith(null, 'chat_sources_mode_changed', {
      workspace_id: 'workspace-1',
      mode: 'assistant',
    })
  })

  it('does not report re-selecting the current choice', () => {
    useMothershipModeStore.getState().setMode('search')
    mount()

    click(radios()[0])

    expect(useMothershipModeStore.getState().assistant).toBe(false)
    expect(mockCaptureEvent).not.toHaveBeenCalled()
  })
})
