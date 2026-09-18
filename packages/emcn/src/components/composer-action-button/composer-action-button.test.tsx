/** @vitest-environment jsdom */
import { act, createRef, type ReactNode } from 'react'
import { Button, ComposerActionButton } from '@sim/emcn'
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

function button() {
  const element = container?.querySelector('button')
  if (!element) throw new Error('Button did not render')
  return element
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

/** Exact pre-migration class inputs from the organization composer and workflow chat. */
const PREVIOUS = {
  md: {
    base: 'size-[28px] rounded-full border-0 p-0',
    active: 'bg-[#383838] hover:bg-[#575757] dark:bg-[#E0E0E0] dark:hover:bg-[#CFCFCF]',
  },
  sm: {
    base: 'size-[22px] rounded-full p-0',
    active: 'bg-[#383838] hover-hover:bg-[#575757] dark:bg-[#E0E0E0] dark:hover-hover:bg-[#CFCFCF]',
  },
} as const

describe('ComposerActionButton', () => {
  for (const size of ['md', 'sm'] as const) {
    for (const active of [true, false]) {
      it(`preserves the previous ${size} markup with active=${active}`, () => {
        const previous = PREVIOUS[size]
        const view = mount(
          <>
            <Button
              variant='ghost'
              aria-label='Send'
              className={`${previous.base} ${active ? previous.active : 'bg-[#808080] dark:bg-[#808080]'} shrink-0`}
            >
              <svg className='size-[16px] text-white dark:text-black' aria-hidden='true' />
            </Button>
            <ComposerActionButton
              aria-label='Send'
              size={size === 'md' ? undefined : size}
              active={active ? undefined : false}
              className='shrink-0'
            >
              <svg className='size-[16px] text-white dark:text-black' aria-hidden='true' />
            </ComposerActionButton>
          </>
        )
        const [before, after] = view.querySelectorAll('button')
        before.className = before.className.split(/\s+/).sort().join(' ')
        after.className = after.className.split(/\s+/).sort().join(' ')
        expect(after.outerHTML).toBe(before.outerHTML)
      })
    }
  }

  it('forwards refs and events while keeping active appearance independent of disabled', () => {
    const ref = createRef<HTMLButtonElement>()
    const onClick = vi.fn()
    const onKeyDown = vi.fn()
    const action = (disabled: boolean) => (
      <ComposerActionButton
        ref={ref}
        aria-label='Send message'
        data-action='send'
        active
        disabled={disabled}
        onClick={onClick}
        onKeyDown={onKeyDown}
      />
    )
    mount(action(false))
    expect(ref.current).toBe(button())
    expect(button().dataset.action).toBe('send')
    act(() => button().focus())
    expect(document.activeElement).toBe(button())
    const keyEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    act(() => button().dispatchEvent(keyEvent))
    expect(onKeyDown).toHaveBeenCalledTimes(1)
    expect(onKeyDown.mock.calls[0][0].nativeEvent).toBe(keyEvent)
    act(() => button().click())
    expect(onClick).toHaveBeenCalledTimes(1)
    const activeClasses = button().className
    act(() => root?.render(action(true)))
    expect(button().disabled).toBe(true)
    expect(button().className).toBe(activeClasses)
    act(() => button().click())
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  for (const type of [undefined, 'button'] as const) {
    it(`preserves native form behavior for type=${type ?? 'omitted'}`, () => {
      const onSubmit = vi.fn((event) => event.preventDefault())
      mount(
        <form onSubmit={onSubmit}>
          <ComposerActionButton aria-label='Search' type={type} />
        </form>
      )
      act(() => button().click())
      expect(onSubmit).toHaveBeenCalledTimes(type === 'button' ? 0 : 1)
    })
  }
})
