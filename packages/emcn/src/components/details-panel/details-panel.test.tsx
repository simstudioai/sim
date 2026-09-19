/** @vitest-environment jsdom */
import { act, createRef } from 'react'
import { DetailsPanel } from '@sim/emcn'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

it('forwards resize events and retains content and refs while closed', () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const ref = createRef<HTMLDivElement>()
  const resize = vi.fn()
  const render = (open: boolean) => (
    <DetailsPanel
      ref={ref}
      open={open}
      width={520}
      onResizeStart={resize}
      resizeLabel='Resize details'
      aria-label='Details'
    >
      <input aria-label='Search details' defaultValue='Retained query' />
    </DetailsPanel>
  )

  try {
    act(() => root.render(render(true)))
    const panel = ref.current!
    const input = panel.querySelector('input')!
    const handle = container.querySelector('[role="separator"]')!
    expect(handle.getAttribute('aria-label')).toBe('Resize details')
    expect(panel.contains(handle)).toBe(false)
    act(() => handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 240 })))
    expect(resize).toHaveBeenCalledTimes(1)
    expect(resize.mock.calls[0][0].clientX).toBe(240)

    act(() => root.render(render(false)))
    expect(ref.current).toBe(panel)
    expect(panel.querySelector('input')).toBe(input)
    expect(input.value).toBe('Retained query')
    expect(container.querySelector('[role="separator"]')).toBeNull()
    act(() => root.render(render(true)))
    expect(panel.querySelector('input')).toBe(input)
    expect(container.querySelector('[role="separator"]')).not.toBeNull()
  } finally {
    act(() => root.unmount())
    container.remove()
  }
})
