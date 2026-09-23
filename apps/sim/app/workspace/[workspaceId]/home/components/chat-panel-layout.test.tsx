/** @vitest-environment jsdom */
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  ChatPanelContent,
  ChatPanelLayout,
} from '@/app/workspace/[workspaceId]/home/components/chat-panel-layout'

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  vi.unstubAllGlobals()
})

it('preserves the native panel anchor and forwarded DOM ref while marking collapsed content inert', async () => {
  const ref = createRef<HTMLDivElement>()
  const interaction = vi.fn()
  const render = async (collapsed: boolean) =>
    act(async () =>
      root.render(
        <ChatPanelContent
          ref={ref}
          collapsed={collapsed}
          onInteraction={interaction}
          className='custom-panel'
        >
          <button>Resource content</button>
        </ChatPanelContent>
      )
    )
  await render(false)
  const element = container.querySelector<HTMLDivElement>('[data-mothership-panel]')!
  expect(ref.current).toBe(element)
  expect(element.classList.contains('custom-panel')).toBe(true)
  expect(element.classList.contains('[--workspace-content-title-bar-inset:0px]')).toBe(true)
  await act(async () => {
    element.firstElementChild!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    element.firstElementChild!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
  })
  expect(interaction).toHaveBeenCalledTimes(2)
  await render(true)
  expect(ref.current).toBe(element)
  expect(element.hasAttribute('inert')).toBe(true)
  expect(element.textContent).toBe('Resource content')
  await render(false)
  expect(element.hasAttribute('inert')).toBe(false)
})

it.each([1, 2])(
  'announces %s resource updates and routes expansion to the owning controller',
  async (count) => {
    const toggle = vi.fn()
    await act(async () =>
      root.render(
        <ChatPanelLayout
          collapsed
          label='resource view'
          activityCount={count}
          onToggle={toggle}
          onResize={vi.fn()}
          panel={<div>Resources</div>}
        >
          <div>Conversation</div>
        </ChatPanelLayout>
      )
    )
    const button = container.querySelector('button')!
    expect(button.getAttribute('aria-label')).toBe(
      `Expand resource view, ${count} resource${count === 1 ? '' : 's'} updated`
    )
    expect(container.querySelector('[role="separator"]')).toBeNull()
    await act(async () => button.click())
    expect(toggle).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Conversation')
    expect(container.textContent).toContain('Resources')
  }
)
