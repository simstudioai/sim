/** @vitest-environment jsdom */
import { act, useState } from 'react'
import { ChipModalField, IconSwitch } from '@sim/emcn'
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
  inModalField?: boolean
  onValueChange: (value: string) => void
}

function Harness({ disabled, showTooltips, inModalField, onValueChange }: HarnessProps) {
  const [value, setValue] = useState('selector')
  const toggle = (
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
  return inModalField ? (
    <ChipModalField type='custom' title='Folder' titleAdornment={toggle}>
      <input aria-label='Folder ID' />
    </ChipModalField>
  ) : (
    toggle
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
    inputs: [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')],
    labels: [...container.querySelectorAll<HTMLLabelElement>('[role="radiogroup"] label')],
  }
}

describe('IconSwitch', () => {
  it('changes mode beside a modal field title without making title clicks change mode', () => {
    const onValueChange = vi.fn()
    const { inputs, labels } = mount({ inModalField: true, onValueChange })
    const title = [...container.querySelectorAll('label')].find(
      (label) => label.textContent === 'Folder'
    )
    expect(title).toBeDefined()
    expect(container.querySelector('[role="radiogroup"]')?.closest('label')).toBeNull()

    act(() => labels[1].click())
    expect(inputs.map((input) => input.checked)).toEqual([false, true])
    expect(onValueChange).toHaveBeenLastCalledWith('variable')

    act(() => title?.click())
    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(inputs.map((input) => input.checked)).toEqual([false, true])
  })

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
