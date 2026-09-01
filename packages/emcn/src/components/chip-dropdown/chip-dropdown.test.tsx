/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ChipDropdown, type ChipDropdownProps } from './chip-dropdown'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(props: Pick<ChipDropdownProps, 'fullWidth' | 'variant'> = {}): HTMLButtonElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <ChipDropdown
        value='workflow'
        options={[{ value: 'workflow', label: 'Workflow' }]}
        aria-label='Principal type'
        {...props}
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
    expect(mount({ fullWidth: true }).className).toContain('w-full')
  })

  it('keeps its intrinsic width by default', () => {
    expect(mount({ fullWidth: false }).className).not.toContain('w-full')
  })

  it('renders its text trigger through the fade-only overflow primitive', () => {
    const label = mount({ fullWidth: true }).querySelector<HTMLElement>('[data-overflow-text]')

    expect(label?.textContent).toBe('Workflow')
    expect(label?.className).toContain('text-clip')
    expect(label?.className).not.toContain('truncate')
  })

  it('renders the filled trigger with the border by default', () => {
    const trigger = mount()
    expect(trigger.className).toContain('border')
    expect(trigger.className).toContain('bg-[var(--surface-5)]')
  })

  it('renders the ghost trigger as the bare pill — no border, no fill, icon-tinted label', () => {
    const trigger = mount({ variant: 'ghost' })
    expect(trigger.className).not.toContain('border')
    expect(trigger.className).not.toContain('bg-[var(--surface-5)]')
    expect(trigger.className).toContain('hover-hover:bg-[var(--surface-hover)]')

    const label = trigger.querySelector<HTMLElement>('[data-overflow-text]')
    expect(label?.className).toContain('text-[var(--text-icon)]')
    expect(label?.className).not.toContain('text-[var(--text-body)]')
  })
})
