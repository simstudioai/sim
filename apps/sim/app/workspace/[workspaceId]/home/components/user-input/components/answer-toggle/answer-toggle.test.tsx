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

import { AnswerToggle } from '@/app/workspace/[workspaceId]/home/components/user-input/components/answer-toggle/answer-toggle'
import { useMothershipModeStore } from '@/stores/mothership-mode/store'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<AnswerToggle />))
}

function button(): HTMLButtonElement | null {
  return container?.querySelector('button') ?? null
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

describe('AnswerToggle', () => {
  it('renders nothing outside Search mode', () => {
    mount()
    expect(button()).toBeNull()
  })

  it('shows an unpressed Answer chip in Search mode and flips the shared flag on click', () => {
    useMothershipModeStore.getState().setMode('search')
    mount()

    const chip = button()
    expect(chip?.textContent).toBe('Answer')
    expect(chip?.getAttribute('aria-pressed')).toBe('false')

    act(() => {
      chip?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    })

    expect(useMothershipModeStore.getState().answer).toBe(true)
    expect(button()?.getAttribute('aria-pressed')).toBe('true')
    expect(mockCaptureEvent).toHaveBeenCalledWith(null, 'chat_answer_toggled', {
      workspace_id: 'workspace-1',
      enabled: true,
    })
  })
})
