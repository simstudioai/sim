/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ChipSwitch } from './chip-switch'

let root: Root | null = null
let container: HTMLDivElement | null = null

const OPTIONS = [
  { value: 'logs', label: 'Logs' },
  { value: 'input', label: 'Workflow input' },
] as const

function mount(className?: string): HTMLElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <ChipSwitch
        value='logs'
        onChange={() => {}}
        options={OPTIONS}
        aria-label='Stage'
        className={className}
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
})
