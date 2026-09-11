/**
 * @vitest-environment jsdom
 */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChipSwitch, type ChipSwitchOption } from './chip-switch'

let root: Root | null = null
let container: HTMLDivElement | null = null

const OPTIONS = [
  { value: 'logs', label: 'Logs' },
  { value: 'input', label: 'Workflow input' },
] as const

interface ControlledSwitchProps {
  className?: string
  disabled?: boolean
  options?: readonly ChipSwitchOption[]
  initialValue: string
  onChange: (value: string) => void
}

function ControlledSwitch({
  className,
  initialValue,
  onChange,
  disabled,
  options = OPTIONS,
}: ControlledSwitchProps) {
  const [value, setValue] = useState(initialValue)
  return (
    <ChipSwitch
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
      options={options}
      disabled={disabled}
      aria-label='Stage'
      className={className}
    />
  )
}

function mount(
  className?: string,
  initialValue = 'logs',
  onChange = vi.fn(),
  props: Pick<ControlledSwitchProps, 'disabled' | 'options'> = {}
): HTMLElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <ControlledSwitch
        initialValue={initialValue}
        onChange={onChange}
        className={className}
        {...props}
      />
    )
  )
  const trough = container.querySelector<HTMLElement>('[role="radiogroup"]')
  if (!trough) throw new Error('trough not rendered')
  return trough
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.useRealTimers()
})

describe('ChipSwitch', () => {
  it('hugs its segments by default', () => {
    expect(mount().className).toContain('w-fit')
  })

  it('lets a caller-supplied width win', () => {
    const className = mount('w-full').className
    expect(className).toContain('w-full')
    expect(className).not.toContain('w-fit')
  })

  it('marks only the active segment as checked', () => {
    const trough = mount()
    const checked = [...trough.querySelectorAll('[role="radio"]')].map((segment) =>
      segment.getAttribute('aria-checked')
    )
    expect(checked).toEqual(['true', 'false'])
  })

  it('changes selection once when an unchecked segment is clicked', () => {
    const onChange = vi.fn()
    const trough = mount(undefined, 'logs', onChange)
    const inputs = trough.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    act(() => inputs[1].click())
    expect(inputs[1].getAttribute('aria-checked')).toBe('true')
    expect(onChange).toHaveBeenCalledExactlyOnceWith('input')
    act(() => inputs[1].click())
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('moves focus and selection with arrow keys and wraps at either end', () => {
    vi.useFakeTimers()
    const trough = mount()
    const inputs = trough.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    act(() => inputs[0].focus())
    for (const [key, expectedIndex] of [
      ['ArrowRight', 1],
      ['ArrowRight', 0],
      ['ArrowLeft', 1],
    ] as const) {
      act(() => {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
        vi.runAllTimers()
      })
      act(() => {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }))
      })
      expect(document.activeElement).toBe(inputs[expectedIndex])
      expect(inputs[expectedIndex].getAttribute('aria-checked')).toBe('true')
      expect([...inputs].filter((input) => input.tabIndex === 0)).toEqual([inputs[expectedIndex]])
    }
  })

  it('disables every segment while preserving the selected value', () => {
    const onChange = vi.fn()
    const trough = mount(undefined, 'logs', onChange, { disabled: true })
    const inputs = trough.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    expect([...inputs].every((input) => input.disabled)).toBe(true)
    act(() => inputs[1].click())
    expect(onChange).not.toHaveBeenCalled()
    expect(inputs[0].getAttribute('aria-checked')).toBe('true')
  })

  it('skips disabled options when selecting with the pointer or keyboard', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const trough = mount(undefined, 'logs', onChange, {
      options: [
        ...OPTIONS.slice(0, 1),
        { ...OPTIONS[1], disabled: true },
        { value: 'output', label: 'Output' },
      ],
    })
    const inputs = trough.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    expect(inputs[1].disabled).toBe(true)
    act(() => inputs[1].click())
    expect(onChange).not.toHaveBeenCalled()
    act(() => {
      inputs[0].focus()
      inputs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      vi.runAllTimers()
    })
    expect(document.activeElement).toBe(inputs[2])
    expect(inputs[2].getAttribute('aria-checked')).toBe('true')
    expect(onChange).toHaveBeenCalledExactlyOnceWith('output')
  })

  it('keeps all segments unchecked when the value has no matching option', () => {
    const trough = mount(undefined, '')
    expect(trough.querySelector('[aria-checked="true"]')).toBeNull()
  })
})
