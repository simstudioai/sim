/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ChipDropdown } from './chip-dropdown'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(fullWidth: boolean): HTMLButtonElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <ChipDropdown
        value='workflow'
        options={[{ value: 'workflow', label: 'Workflow' }]}
        fullWidth={fullWidth}
        aria-label='Principal type'
      />
    )
  )

  const trigger = container.querySelector<HTMLButtonElement>('button')
  if (!trigger) throw new Error('ChipDropdown did not render a trigger')
  return trigger
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('ChipDropdown', () => {
  it('fills its container when fullWidth is enabled', () => {
    expect(mount(true).className).toContain('w-full')
  })

  it('keeps its intrinsic width by default', () => {
    expect(mount(false).className).not.toContain('w-full')
  })
})
