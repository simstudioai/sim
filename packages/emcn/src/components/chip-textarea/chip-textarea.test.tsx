/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ChipTextarea } from './chip-textarea'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(ui: ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(ui))
}

describe('ChipTextarea', () => {
  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
  })

  it('keeps view-only content legible without disabling the field', () => {
    mount(<ChipTextarea value='Generated value' viewOnly readOnly={false} />)

    const textarea = container?.querySelector('textarea')
    expect(textarea?.readOnly).toBe(true)
    expect(textarea?.disabled).toBe(false)
    expect(textarea?.className).toContain('cursor-default')
  })

  it('applies error and resize state through props', () => {
    mount(<ChipTextarea error resizable />)

    const textarea = container?.querySelector('textarea')
    expect(textarea?.className).toContain('border-[var(--text-error)]')
    expect(textarea?.className).toContain('resize-y')
    expect(textarea?.className).not.toContain('resize-none')
  })
})
