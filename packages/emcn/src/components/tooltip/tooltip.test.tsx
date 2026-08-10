/**
 * @vitest-environment jsdom
 *
 * The floating tooltip hides from pointer/focus events on its trigger — but a keyboard- or
 * script-driven UI change (e.g. tiptap's bubble menu setting `visibility: hidden` on Cmd+A) hides
 * the trigger with no such event, and browsers don't re-dispatch boundary events until the pointer
 * moves. These tests cover the visibility watcher that dismisses a shown tooltip once its trigger
 * is hidden or removed, and that it leaves a still-visible trigger's tooltip alone.
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Tooltip } from './tooltip'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(ui: ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(ui))
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.useRealTimers()
})

function trigger(): HTMLButtonElement {
  const node = container?.querySelector('button')
  if (!node) throw new Error('Trigger did not render')
  return node
}

function hover(node: HTMLElement) {
  act(() => {
    node.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, clientX: 200, clientY: 200 }))
  })
}

/** Generously past TRIGGER_VISIBILITY_INTERVAL_MS so at least one watcher tick has run. */
function runWatcherTick() {
  act(() => {
    vi.advanceTimersByTime(500)
  })
}

function tooltipElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="tooltip"]')
}

function tooltipUi(withTrigger: boolean) {
  return (
    <Tooltip.Root>
      {withTrigger && <Tooltip.Trigger>Hover me</Tooltip.Trigger>}
      <Tooltip.Content>Delete column</Tooltip.Content>
    </Tooltip.Root>
  )
}

function mountTooltip() {
  mount(tooltipUi(true))
}

describe('floating tooltip trigger visibility watcher', () => {
  it('keeps the tooltip shown while the trigger stays visible', () => {
    mountTooltip()
    hover(trigger())
    expect(tooltipElement()).not.toBeNull()

    runWatcherTick()
    expect(tooltipElement()).not.toBeNull()
  })

  it('dismisses the tooltip when the trigger is hidden without a pointer event', () => {
    mountTooltip()
    hover(trigger())
    expect(tooltipElement()).not.toBeNull()

    trigger().style.visibility = 'hidden'
    runWatcherTick()
    expect(tooltipElement()).toBeNull()
  })

  it('dismisses the tooltip when the trigger is display: none without a pointer event', () => {
    mountTooltip()
    hover(trigger())
    expect(tooltipElement()).not.toBeNull()

    trigger().style.display = 'none'
    runWatcherTick()
    expect(tooltipElement()).toBeNull()
  })

  it('dismisses the tooltip when an ancestor becomes display: none', () => {
    mountTooltip()
    hover(trigger())
    expect(tooltipElement()).not.toBeNull()

    if (!container) throw new Error('Container did not mount')
    container.style.display = 'none'
    runWatcherTick()
    expect(tooltipElement()).toBeNull()
  })

  it('dismisses the tooltip when the trigger unmounts from under a static pointer', () => {
    mountTooltip()
    hover(trigger())
    expect(tooltipElement()).not.toBeNull()

    act(() => root?.render(tooltipUi(false)))
    runWatcherTick()
    expect(tooltipElement()).toBeNull()
  })

  it('still hides on pointer leave', () => {
    mountTooltip()
    const node = trigger()
    hover(node)
    expect(tooltipElement()).not.toBeNull()

    act(() => {
      node.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }))
    })
    expect(tooltipElement()).toBeNull()
  })
})
