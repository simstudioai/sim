/** @vitest-environment jsdom */
import { act, createRef, type ReactNode } from 'react'
import { Button, OverlayActionButton, Tooltip } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(children: ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(children))
  return container
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.useRealTimers()
})

/** Pre-migration recipes from log details and the deployment preview. */
const PREVIOUS = [
  {
    name: 'default 20px adaptive action',
    props: {},
    variant: 'default',
    className:
      'size-[20px] cursor-pointer border-[var(--border-1)] bg-transparent p-0 backdrop-blur-xs hover-hover:bg-[var(--surface-3)]',
  },
  {
    name: '28px adaptive action',
    props: { size: 'md' },
    variant: 'default',
    className:
      'size-[28px] cursor-pointer bg-transparent p-0 backdrop-blur-xs hover-hover:bg-[var(--surface-3)]',
  },
] as const

describe('OverlayActionButton', () => {
  it.each(PREVIOUS)('preserves the previous $name markup', ({ props, variant, className }) => {
    const view = mount(
      <>
        <Button variant={variant} aria-label='Copy' className={`${className} shrink-0`}>
          <svg className='size-[10px]' aria-hidden='true' />
        </Button>
        <OverlayActionButton {...props} aria-label='Copy' className='shrink-0'>
          <svg className='size-[10px]' aria-hidden='true' />
        </OverlayActionButton>
      </>
    )
    const [previous, current] = view.querySelectorAll('button')
    /** The old border-1 token aliases border; class order changes when recipes are composed. */
    for (const button of [previous, current]) {
      button.className = button.className
        .replaceAll('--border-1', '--border')
        .split(/\s+/)
        .sort()
        .join(' ')
    }
    expect(current.outerHTML).toBe(previous.outerHTML)
  })

  it('forwards refs and native props through a tooltip and suppresses disabled clicks', () => {
    vi.useFakeTimers()
    const ref = createRef<HTMLButtonElement>()
    const onClick = vi.fn()
    const onKeyDown = vi.fn()
    const action = (disabled: boolean) => (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <OverlayActionButton
            ref={ref}
            type='button'
            aria-label='Copy'
            data-action='copy'
            disabled={disabled}
            onClick={onClick}
            onKeyDown={onKeyDown}
          />
        </Tooltip.Trigger>
        <Tooltip.Content>Copy output</Tooltip.Content>
      </Tooltip.Root>
    )
    const view = mount(action(false))
    const button = view.querySelector('button')
    if (!button) throw new Error('Button did not render')
    expect(view.querySelectorAll('button')).toHaveLength(1)
    expect(ref.current).toBe(button)
    expect(button.type).toBe('button')
    expect(button.dataset.action).toBe('copy')
    expect(button.getAttribute('aria-label')).toBe('Copy')
    act(() =>
      button.dispatchEvent(
        new MouseEvent('pointerover', { bubbles: true, clientX: 200, clientY: 200 })
      )
    )
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Copy output')
    act(() => button.focus())
    expect(document.activeElement).toBe(button)
    const keyEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    act(() => button.dispatchEvent(keyEvent))
    expect(onKeyDown).toHaveBeenCalledTimes(1)
    expect(onKeyDown.mock.calls[0][0].nativeEvent).toBe(keyEvent)
    act(() => button.click())
    expect(onClick).toHaveBeenCalledTimes(1)
    act(() => root?.render(action(true)))
    expect(button.disabled).toBe(true)
    act(() => button.click())
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
