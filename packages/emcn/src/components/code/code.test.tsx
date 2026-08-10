/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Code } from './code'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(ui: ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(ui))
}

describe('Code.Container', () => {
  beforeEach(() => {
    container = null
    root = null
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
  })

  it('uses chip field chrome for interactive field contexts', () => {
    mount(
      <Code.Container appearance='field'>
        <Code.Gutter width={24}>1</Code.Gutter>
      </Code.Container>
    )

    const surface = container?.firstElementChild
    const gutter = surface?.firstElementChild
    expect(surface?.className).toContain('rounded-lg')
    expect(surface?.className).toContain('font-normal')
    expect(gutter?.className).toContain('rounded-l-lg')
    expect(gutter?.className).toContain('bg-transparent')
  })

  it('preserves code-centric chrome by default', () => {
    mount(
      <Code.Container>
        <Code.Gutter width={24}>1</Code.Gutter>
      </Code.Container>
    )

    const surface = container?.firstElementChild
    const gutter = surface?.firstElementChild
    expect(surface?.className).toContain('rounded-sm')
    expect(surface?.className).toContain('font-normal')
    expect(gutter?.className).toContain('rounded-l-[4px]')
  })
})
