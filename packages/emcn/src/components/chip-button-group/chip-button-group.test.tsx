/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChipButtonGroup, ChipButtonGroupItem } from './chip-button-group'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(children: ReactNode): HTMLElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(children))
  const group = container.querySelector<HTMLElement>('[role="radiogroup"]')
  if (!group) throw new Error('Button group not rendered')
  return group
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.useRealTimers()
})

function ControlledGroup({
  onChange,
  children,
}: {
  onChange: (value: string) => void
  children?: ReactNode
}) {
  const [value, setValue] = useState('member')
  return (
    <ChipButtonGroup
      value={value}
      aria-label='Connection type'
      onValueChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    >
      {children ?? (
        <>
          <ChipButtonGroupItem value='member'>Member accounts</ChipButtonGroupItem>
          <ChipButtonGroupItem value='service'>
            Service account <span>Recommended</span>
          </ChipButtonGroupItem>
        </>
      )}
    </ChipButtonGroup>
  )
}

describe('ChipButtonGroup', () => {
  it('preserves compound children, accessible labels, and selection callbacks', () => {
    const onChange = vi.fn()
    const group = mount(<ControlledGroup onChange={onChange} />)
    const items = group.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    expect(group.getAttribute('aria-label')).toBe('Connection type')
    expect(items[1].querySelector('span')?.textContent).toBe('Recommended')
    expect(items[0].getAttribute('aria-checked')).toBe('true')
    act(() => items[1].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith('service')
    expect(items[0].getAttribute('aria-checked')).toBe('false')
    expect(items[1].getAttribute('aria-checked')).toBe('true')
    act(() => items[1].click())
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('moves selection with arrow keys, skips disabled options, and wraps focus', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const group = mount(
      <ControlledGroup onChange={onChange}>
        <ChipButtonGroupItem value='member'>Member accounts</ChipButtonGroupItem>
        <ChipButtonGroupItem value='service' disabled>
          Service account
        </ChipButtonGroupItem>
        <ChipButtonGroupItem value='manual'>API token</ChipButtonGroupItem>
      </ControlledGroup>
    )
    const items = group.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    act(() => items[0].focus())
    for (const [key, expectedIndex, expectedValue] of [
      ['ArrowRight', 2, 'manual'],
      ['ArrowRight', 0, 'member'],
      ['ArrowLeft', 2, 'manual'],
    ] as const) {
      act(() => {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
        vi.runAllTimers()
      })
      act(() => {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }))
      })
      expect(document.activeElement).toBe(items[expectedIndex])
      expect(items[expectedIndex].getAttribute('aria-checked')).toBe('true')
      expect([...items].filter((item) => item.tabIndex === 0)).toEqual([items[expectedIndex]])
      expect(onChange).toHaveBeenLastCalledWith(expectedValue)
    }
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('keeps selection controlled until the caller supplies a new value', () => {
    const onChange = vi.fn()
    const group = mount(
      <ChipButtonGroup value='member' onValueChange={onChange}>
        <ChipButtonGroupItem value='member'>Member accounts</ChipButtonGroupItem>
        <ChipButtonGroupItem value='service'>Service account</ChipButtonGroupItem>
      </ChipButtonGroup>
    )
    const items = group.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    act(() => items[1].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith('service')
    expect(items[0].getAttribute('aria-checked')).toBe('true')
    expect(items[1].getAttribute('aria-checked')).toBe('false')
  })

  it('disables the entire group without losing its selected value', () => {
    const onChange = vi.fn()
    const group = mount(
      <ChipButtonGroup value='member' disabled onValueChange={onChange}>
        <ChipButtonGroupItem value='member'>Member accounts</ChipButtonGroupItem>
        <ChipButtonGroupItem value='service'>Service account</ChipButtonGroupItem>
      </ChipButtonGroup>
    )
    const items = group.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    expect([...items].every((item) => item.disabled)).toBe(true)
    act(() => items[1].click())
    expect(onChange).not.toHaveBeenCalled()
    expect(items[0].getAttribute('aria-checked')).toBe('true')
  })

  it('keeps a disabled option unavailable while other options remain selectable', () => {
    const onChange = vi.fn()
    const group = mount(
      <ChipButtonGroup value='member' onValueChange={onChange}>
        <ChipButtonGroupItem value='member'>Member accounts</ChipButtonGroupItem>
        <ChipButtonGroupItem value='service' disabled>
          Service account
        </ChipButtonGroupItem>
        <ChipButtonGroupItem value='manual'>API token</ChipButtonGroupItem>
      </ChipButtonGroup>
    )
    const items = group.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    act(() => items[1].click())
    expect(onChange).not.toHaveBeenCalled()
    act(() => items[2].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith('manual')
  })
})
