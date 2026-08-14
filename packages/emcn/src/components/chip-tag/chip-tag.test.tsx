/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChipTag } from './chip-tag'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(ui: ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(ui))
}

describe('ChipTag', () => {
  beforeEach(() => {
    container = null
    root = null
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
  })

  it.each([
    ['green', '--badge-success-bg', '--badge-success-text'],
    ['red', '--badge-error-bg', '--badge-error-text'],
    ['amber', '--badge-amber-bg', '--badge-amber-text'],
  ] as const)('renders the %s semantic status variant', (variant, background, text) => {
    mount(<ChipTag variant={variant}>Status</ChipTag>)

    const tag = container?.querySelector('span')
    expect(tag?.className).toContain(background)
    expect(tag?.className).toContain(text)
  })
})
