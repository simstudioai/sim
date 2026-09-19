/** @vitest-environment jsdom */
import { act, createRef } from 'react'
import { DetailsPanel, type DetailsPanelProps } from '@sim/emcn'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

it('forwards resize events and retains content and refs while closed', () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const ref = createRef<HTMLDivElement>()
  const resize = vi.fn()
  const render = (open: boolean, width: DetailsPanelProps['width'] = 520) => (
    <DetailsPanel
      ref={ref}
      open={open}
      width={width}
      style={{ width: 1, opacity: 0.9 }}
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
    expect(panel.style.getPropertyValue('--details-panel-width')).toBe('520px')
    expect(panel.style.width).toBe('')
    expect(panel.style.opacity).toBe('0.9')
    expect(panel.hasAttribute('inert')).toBe(false)
    const input = panel.querySelector('input')!
    const handle = container.querySelector<HTMLDivElement>('[role="separator"]')!
    expect(handle.style.getPropertyValue('--details-panel-width')).toBe('520px')
    expect(handle.getAttribute('aria-label')).toBe('Resize details')
    expect(panel.contains(handle)).toBe(false)
    act(() => handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 240 })))
    expect(resize).toHaveBeenCalledTimes(1)
    expect(resize.mock.calls[0][0].clientX).toBe(240)

    act(() => root.render(render(false)))
    expect(panel.hasAttribute('inert')).toBe(true)
    expect(ref.current).toBe(panel)
    expect(panel.querySelector('input')).toBe(input)
    expect(input.value).toBe('Retained query')
    expect(container.querySelector('[role="separator"]')).toBeNull()
    const responsiveWidth = 'clamp(min(320px, 60vw), 520px, 60vw)'
    act(() => root.render(render(true, responsiveWidth)))
    expect(panel.style.getPropertyValue('--details-panel-width')).toBe(responsiveWidth)
    expect(panel.hasAttribute('inert')).toBe(false)
    expect(panel.querySelector('input')).toBe(input)
    expect(container.querySelector('[role="separator"]')).not.toBeNull()
  } finally {
    act(() => root.unmount())
    container.remove()
  }
})
