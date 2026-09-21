/** @vitest-environment jsdom */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WandPromptBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/wand-prompt-bar/wand-prompt-bar'

let container: HTMLDivElement
let root: Root
const onSubmit = vi.fn()
const onCancel = vi.fn()
const onChange = vi.fn()

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

function render(props: Partial<ComponentProps<typeof WandPromptBar>> = {}) {
  act(() =>
    root.render(
      <WandPromptBar
        isVisible
        isLoading={false}
        isStreaming={false}
        promptValue='Explain this code'
        onSubmit={onSubmit}
        onCancel={onCancel}
        onChange={onChange}
        {...props}
      />
    )
  )
}

function button(label: string) {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
}

function key(key: string) {
  act(() =>
    container
      .querySelector('input')!
      .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  )
}

describe('WandPromptBar actions', () => {
  it('submits the same prompt by click and Enter, and blocks empty prompts', () => {
    render()
    act(() => button('Generate content').click())
    key('Enter')
    expect(onSubmit.mock.calls).toEqual([['Explain this code'], ['Explain this code']])
    render({ promptValue: '  ' })
    expect(button('Generate content').disabled).toBe(true)
    act(() => button('Generate content').click())
    key('Enter')
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it('preserves pending and streaming restrictions', () => {
    render({ isLoading: true })
    expect(container.querySelector('input')!.disabled).toBe(true)
    expect(button('Generate content').disabled).toBe(true)
    act(() => {
      button('Generate content').click()
      button('Close AI prompt').click()
    })
    key('Escape')
    act(() => vi.runAllTimers())
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()

    render({ isStreaming: true })
    expect(container.querySelector('input')!.value).toBe('Generating...')
    expect(button('Generate content')).toBeNull()
    act(() => button('Close AI prompt').click())
    act(() => vi.runAllTimers())
    expect(onCancel).not.toHaveBeenCalled()
  })

  it.each(['button', 'Escape', 'outside'] as const)(
    'closes through %s after the existing exit delay',
    (method) => {
      render()
      if (method === 'button') act(() => button('Close AI prompt').click())
      else if (method === 'Escape') key('Escape')
      else act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
      expect(onCancel).not.toHaveBeenCalled()
      act(() => vi.advanceTimersByTime(150))
      expect(onCancel).toHaveBeenCalledTimes(1)
    }
  )
})
