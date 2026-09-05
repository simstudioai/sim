/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { Tooltip } from '@sim/emcn'
import { Blimp, Bold } from '@sim/emcn/icons'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolbarButton } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/toolbar-button'

describe('ToolbarButton', () => {
  const rendered: Array<{ host: HTMLDivElement; root: Root }> = []

  afterEach(() => {
    for (const { host, root } of rendered) {
      act(() => root.unmount())
      host.remove()
    }
    rendered.length = 0
  })

  function renderButton(button: ReactNode): HTMLDivElement {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(<Tooltip.Provider>{button}</Tooltip.Provider>))
    rendered.push({ host, root })
    return host
  }

  it('uses the canonical active button treatment for selected formatting', () => {
    const host = renderButton(<ToolbarButton icon={Bold} label='Bold' isActive onClick={vi.fn()} />)
    const button = host.querySelector('button[aria-label="Bold"]')

    expect(button?.className).toContain('bg-[var(--surface-5)]')
    expect(button?.className).toContain('border-[var(--border-1)]')
    expect(button?.className).toContain('text-[var(--text-primary)]')
  })

  it('supports a compact glyph without reducing the button hit target', () => {
    const host = renderButton(
      <ToolbarButton icon={Blimp} iconSize='compact' label='Add to Chat' onClick={vi.fn()} />
    )

    const button = host.querySelector('button[aria-label="Add to Chat"]')
    expect(button?.className).toContain('size-[28px]')
    expect(button?.querySelector('svg')?.className.baseVal).toContain('size-[12px]')
  })

  it('preserves the editor selection for mouse, pen, and touch activation', () => {
    const host = renderButton(<ToolbarButton icon={Bold} label='Bold' onClick={vi.fn()} />)
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Bold"]')
    expect(button).not.toBeNull()
    if (!button) return

    for (const pointerType of ['mouse', 'pen', 'touch']) {
      const event = new Event('pointerdown', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'pointerType', { value: pointerType })
      act(() => button.dispatchEvent(event))
      expect(event.defaultPrevented).toBe(true)
    }
  })
})
