/** @vitest-environment jsdom */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolUsageControl } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/components/tools/usage-control'

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/short-input',
  () => ({ ShortInput: () => null })
)

let root: Root | undefined
let container: HTMLDivElement | undefined

function mount(overrides: Partial<ComponentProps<typeof ToolUsageControl>> = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const onFixedChange = vi.fn()
  act(() =>
    root?.render(
      <ToolUsageControl
        blockId='block-1'
        aggregateSubBlockId='tools'
        toolIndex={0}
        tool={{ type: 'http_request', usageControlExpression: '"none"' }}
        mode='basic'
        supportsForce={false}
        disabled={false}
        onFixedChange={onFixedChange}
        onExpressionChange={vi.fn()}
        onModeToggle={vi.fn()}
        {...overrides}
      />
    )
  )
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Permission Mode"]'
  )!
  return { trigger, onFixedChange }
}

async function key(node: Element, key: string) {
  act(() => {
    node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10)
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  document.body.removeAttribute('style')
  vi.useRealTimers()
})

describe('tool permission selection', () => {
  it('keeps hints in the menu, skips unsupported Force and reports the stored value', async () => {
    const { trigger, onFixedChange } = mount()
    expect(trigger.textContent).toBe('Auto')
    await key(trigger, 'ArrowDown')
    const force = [...document.querySelectorAll('[role="menuitem"]')].find((item) =>
      item.textContent?.startsWith('Force')
    )!
    expect(force.textContent).toContain('(not supported by model)')
    expect(force.getAttribute('aria-disabled')).toBe('true')
    await key(document.activeElement!, 'ArrowDown')
    expect(document.activeElement?.textContent).toBe('None(disable tool)')
    await key(document.activeElement!, 'Enter')
    expect(onFixedChange).toHaveBeenCalledExactlyOnceWith('none')
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('enables supported Force and closes Escape without changing the value', async () => {
    const { trigger, onFixedChange } = mount({ supportsForce: true })
    await key(trigger, 'ArrowDown')
    await key(document.activeElement!, 'ArrowDown')
    expect(document.activeElement?.textContent).toBe('Force(always use)')
    await key(document.activeElement!, 'Escape')
    expect(onFixedChange).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger)
  })
})
