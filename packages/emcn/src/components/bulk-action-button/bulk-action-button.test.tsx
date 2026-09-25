/** @vitest-environment jsdom */
import { act, createRef, type ReactNode } from 'react'
import { BulkActionButton, Button, DropdownMenu, DropdownMenuTrigger, Tooltip } from '@sim/emcn'
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
  vi.useRealTimers()
})

/** Exact class inputs used by the action bars before migrating into EMCN. */
const PREVIOUS_GEOMETRY =
  'hover-hover:text-[var(--text-inverse)]! size-[28px] rounded-lg p-0 hover-hover:bg-[var(--brand-secondary)]'

describe('BulkActionButton', () => {
  it('uses the shared adaptive fill without changing action geometry', () => {
    const previousFill = 'bg-[var(--surface-5)] dark:bg-[var(--surface-4)]'
    const view = mount(
      <>
        <Button
          variant='ghost'
          aria-label='Delete'
          className={`${previousFill} ${PREVIOUS_GEOMETRY}`}
        >
          <svg className='size-[12px]' aria-hidden='true' />
        </Button>
        <BulkActionButton aria-label='Delete'>
          <svg className='size-[12px]' aria-hidden='true' />
        </BulkActionButton>
      </>
    )
    const [previous, current] = view.querySelectorAll('button')
    /** Class order changes when composing recipes; the resolved utility set must not. */
    previous.className = previous.className.split(/\s+/).sort().join(' ')
    current.className = current.className.split(/\s+/).sort().join(' ')
    expect(current.outerHTML).toBe(previous.outerHTML)
  })

  it('forwards the native ref, attributes and original events', () => {
    const ref = createRef<HTMLButtonElement>()
    const onClick = vi.fn()
    const onKeyDown = vi.fn()
    mount(
      <BulkActionButton
        ref={ref}
        aria-label='Download'
        data-action='download'
        onClick={onClick}
        onKeyDown={onKeyDown}
      />
    )
    expect(ref.current).toBe(button())
    expect(button().dataset.action).toBe('download')
    act(() => button().focus())
    expect(document.activeElement).toBe(button())
    const keyEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    act(() => button().dispatchEvent(keyEvent))
    expect(onKeyDown).toHaveBeenCalledTimes(1)
    expect(onKeyDown.mock.calls[0][0].nativeEvent).toBe(keyEvent)
    act(() => button().click())
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not invoke disabled actions', () => {
    const onClick = vi.fn()
    mount(<BulkActionButton aria-label='Delete' onClick={onClick} disabled />)
    act(() => button().click())
    expect(button().disabled).toBe(true)
    expect(onClick).not.toHaveBeenCalled()
  })

  for (const type of [undefined, 'button'] as const) {
    it(`preserves native form behavior for type=${type ?? 'omitted'}`, () => {
      const onSubmit = vi.fn((event) => event.preventDefault())
      mount(
        <form onSubmit={onSubmit}>
          <BulkActionButton aria-label='Run' type={type} />
        </form>
      )
      act(() => button().click())
      expect(onSubmit).toHaveBeenCalledTimes(type === 'button' ? 0 : 1)
    })
  }

  it('composes with the tooltip and menu triggers used by Move', () => {
    const onOpenChange = vi.fn()
    const onKeyDown = vi.fn()
    const ref = createRef<HTMLButtonElement>()
    mount(
      <DropdownMenu open={false} onOpenChange={onOpenChange}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <DropdownMenuTrigger asChild>
              <BulkActionButton ref={ref} aria-label='Move' onKeyDown={onKeyDown} />
            </DropdownMenuTrigger>
          </Tooltip.Trigger>
          <Tooltip.Content>Move</Tooltip.Content>
        </Tooltip.Root>
      </DropdownMenu>
    )
    expect(container?.querySelectorAll('button')).toHaveLength(1)
    expect(ref.current).toBe(button())
    expect(button().getAttribute('aria-haspopup')).toBe('menu')
    act(() =>
      button().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    )
    expect(onKeyDown).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('retains the tooltip and accessible name on a direct action', () => {
    vi.useFakeTimers()
    mount(
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <BulkActionButton aria-label='Download' />
        </Tooltip.Trigger>
        <Tooltip.Content>Download selected files</Tooltip.Content>
      </Tooltip.Root>
    )
    act(() =>
      button().dispatchEvent(
        new MouseEvent('pointerover', { bubbles: true, clientX: 200, clientY: 200 })
      )
    )
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Download selected files')
    expect(button().getAttribute('aria-label')).toBe('Download')
  })
})
