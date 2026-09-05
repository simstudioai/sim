/** @vitest-environment jsdom */
import { act, useState } from 'react'
import { IconSwitch } from '@sim/emcn'
import { Code, List } from '@sim/emcn/icons'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const OPTIONS = [
  { value: 'selector', label: 'Selector', icon: List },
  { value: 'variable', label: 'Variable', icon: Code },
] as const

interface HarnessProps {
  disabled?: boolean
  showTooltips?: boolean
  onValueChange: (value: string) => void
}

function Harness({ disabled, showTooltips, onValueChange }: HarnessProps) {
  const [value, setValue] = useState('selector')
  return (
    <IconSwitch
      options={OPTIONS}
      value={value}
      onValueChange={(nextValue) => {
        setValue(nextValue)
        onValueChange(nextValue)
      }}
      disabled={disabled}
      showTooltips={showTooltips}
      aria-label='Input mode'
    />
  )
}

let root: Root | null = null
let container: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container.remove()
  root = null
  vi.useRealTimers()
})

function mount(props: HarnessProps) {
  act(() => root?.render(<Harness {...props} />))
  return {
    inputs: [...container.querySelectorAll('input')],
    labels: [...container.querySelectorAll('label')],
  }
}

describe('IconSwitch', () => {
  it('selects either mode without toggling an already selected choice', () => {
    const onValueChange = vi.fn()
    const { inputs, labels } = mount({ onValueChange })

    act(() => labels[1].click())
    expect(inputs.map((input) => input.checked)).toEqual([false, true])
    expect(onValueChange).toHaveBeenLastCalledWith('variable')

    act(() => labels[1].click())
    expect(onValueChange).toHaveBeenCalledTimes(1)

    act(() => labels[0].click())
    expect(inputs.map((input) => input.checked)).toEqual([true, false])
    expect(onValueChange).toHaveBeenLastCalledWith('selector')
  })

  it('prevents selection changes while disabled', () => {
    const onValueChange = vi.fn()
    const { inputs, labels } = mount({ disabled: true, onValueChange })

    act(() => labels[1].click())
    expect(onValueChange).not.toHaveBeenCalled()
    expect(inputs.every((input) => input.disabled)).toBe(true)
    expect(inputs.map((input) => input.checked)).toEqual([true, false])
  })

  it('shows each option label in its hover tooltip', () => {
    const { inputs } = mount({ showTooltips: true, onValueChange: vi.fn() })

    for (const [index, option] of OPTIONS.entries()) {
      act(() => {
        inputs[index].dispatchEvent(
          new MouseEvent('pointerover', { bubbles: true, clientX: 200, clientY: 200 })
        )
      })
      expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(option.label)
      act(() => inputs[index].dispatchEvent(new MouseEvent('pointerout', { bubbles: true })))
    }
  })

  it('shows a tooltip on keyboard focus without changing selection', () => {
    const onValueChange = vi.fn()
    const { inputs } = mount({ showTooltips: true, onValueChange })

    act(() => inputs[1].focus())
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Variable')
    expect(onValueChange).not.toHaveBeenCalled()
    expect(inputs.map((input) => input.checked)).toEqual([true, false])
  })
})
