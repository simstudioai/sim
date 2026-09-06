/** @vitest-environment jsdom */
import { act } from 'react'
import { Tooltip } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageInspector } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-inspector'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
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
  it.each([
    { key: 'Enter', isComposing: true, keyCode: 13 },
    { key: 'Escape', isComposing: true, keyCode: 27 },
    { key: 'Enter', isComposing: false, keyCode: 229 },
    { key: 'Escape', isComposing: false, keyCode: 229 },
  ])('keeps the draft open for composition key $key/$keyCode', async (keyboard) => {
    const onApply = vi.fn()
    const onReturnFocus = vi.fn()
    act(() => {
      root.render(
        <Tooltip.Provider>
          <ImageInspector
            alt='Diagram'
            href=''
            hasCustomSize={false}
            onApply={onApply}
            onResetSize={vi.fn()}
            onReturnFocus={onReturnFocus}
          />
        </Tooltip.Provider>
      )
    })
    act(() => button('Edit image details').click())
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Image alt text"]')!
    change(input, 'Composition draft')
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { ...keyboard, bubbles: true }))
    })

    expect(host.querySelector('input[aria-label="Image alt text"]')).toBe(input)
    expect(input.value).toBe('Composition draft')
    expect(document.activeElement).toBe(input)
    expect(onApply).not.toHaveBeenCalled()
    expect(onReturnFocus).not.toHaveBeenCalled()
  })

  it.each(['alt', 'href', 'neither', 'reverted'] as const)(
    'submits only the locally changed field: %s',
    async (changedField) => {
      const onApply = vi.fn()
      const renderInspector = (alt: string, href: string) => {
        act(() => {
          root.render(
            <Tooltip.Provider>
              <ImageInspector
                alt={alt}
                href={href}
                hasCustomSize={false}
                onApply={onApply}
                onResetSize={vi.fn()}
                onReturnFocus={vi.fn()}
              />
            </Tooltip.Provider>
          )
        })
      }
      renderInspector('Original alt', 'https://sim.ai/original')
      act(() => button('Edit image details').click())
      const alt = host.querySelector<HTMLInputElement>('input[aria-label="Image alt text"]')!
      const href = host.querySelector<HTMLInputElement>('input[aria-label="Image link URL"]')!
      if (changedField === 'alt' || changedField === 'reverted') change(alt, 'Local alt')
      if (changedField === 'href') change(href, '')
      if (changedField === 'reverted') change(alt, 'Original alt')

      renderInspector('Peer alt', 'https://sim.ai/peer')
      expect(alt.value).toBe(changedField === 'alt' ? 'Local alt' : 'Original alt')
      expect(href.value).toBe(changedField === 'href' ? '' : 'https://sim.ai/original')
      await act(async () => {
        href.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })

      if (changedField === 'alt') expect(onApply).toHaveBeenCalledWith({ alt: 'Local alt' })
      else if (changedField === 'href') expect(onApply).toHaveBeenCalledWith({ href: '' })
      else expect(onApply).not.toHaveBeenCalled()
    }
  )

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
