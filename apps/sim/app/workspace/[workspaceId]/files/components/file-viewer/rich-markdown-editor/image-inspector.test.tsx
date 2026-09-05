/** @vitest-environment jsdom */
import { act } from 'react'
import { Tooltip } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageInspector } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-inspector'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function button(label: string): HTMLButtonElement {
  const element = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!element) throw new Error(`Missing ${label} button`)
  return element
}

function change(input: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('ImageInspector', () => {
  it('validates and applies accessible image details', async () => {
    const onApply = vi.fn()
    const onReturnFocus = vi.fn()
    act(() => {
      root.render(
        <Tooltip.Provider>
          <ImageInspector
            alt='Diagram'
            href='https://sim.ai/original'
            hasCustomSize={false}
            onApply={onApply}
            onResetSize={vi.fn()}
            onReturnFocus={onReturnFocus}
          />
        </Tooltip.Provider>
      )
    })

    act(() => button('Edit image details').click())
    expect(host.firstElementChild).toHaveClass('left-0')
    expect(host.firstElementChild).not.toHaveClass('sm:left-1/2', 'sm:-translate-x-1/2')
    const alt = host.querySelector<HTMLInputElement>('input[aria-label="Image alt text"]')
    const href = host.querySelector<HTMLInputElement>('input[aria-label="Image link URL"]')
    expect(alt?.value).toBe('Diagram')
    expect(href?.value).toBe('https://sim.ai/original')
    if (!alt || !href) return

    change(alt, 'Updated diagram')
    href.focus()
    change(href, 'javascript:alert(1)')
    expect(document.activeElement).toBe(href)
    expect(href).toHaveAttribute('aria-invalid', 'true')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('valid link')
    const apply = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((candidate) =>
      candidate.textContent?.includes('Apply')
    )
    expect(apply?.disabled).toBe(true)

    change(href, 'https://sim.ai/updated')
    act(() => apply?.click())
    expect(onApply).toHaveBeenCalledWith({
      alt: 'Updated diagram',
      href: 'https://sim.ai/updated',
    })
    await vi.waitFor(() => expect(onReturnFocus).toHaveBeenCalledTimes(1))
  })

  it('offers size reset only for explicitly sized images', () => {
    const onResetSize = vi.fn()
    act(() => {
      root.render(
        <Tooltip.Provider>
          <ImageInspector
            alt=''
            href=''
            hasCustomSize
            onApply={vi.fn()}
            onResetSize={onResetSize}
            onReturnFocus={vi.fn()}
          />
        </Tooltip.Provider>
      )
    })
    act(() => button('Reset image size').click())
    expect(onResetSize).toHaveBeenCalledTimes(1)
  })
})
