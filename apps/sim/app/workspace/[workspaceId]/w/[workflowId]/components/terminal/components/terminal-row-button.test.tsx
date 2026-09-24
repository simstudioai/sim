/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ROW_STYLES } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/types'
import { StatusDisplay } from './status-display'
import { TerminalRowButton } from './terminal-row-button'

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('TerminalRowButton', () => {
  it('renders selected disclosure semantics and handles one native click locally', () => {
    const onClick = vi.fn()
    const onParentClick = vi.fn()

    act(() => {
      root.render(
        <div onClick={onParentClick}>
          <TerminalRowButton selected aria-expanded data-entry-id='entry-1' onClick={onClick}>
            <span>Workflow result</span>
          </TerminalRowButton>
        </div>
      )
    })

    const button = host.querySelector('button')!
    expect(button.type).toBe('button')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('data-entry-id')).toBe('entry-1')
    expect(button.className).toBe(ROW_STYLES.rowSelected)
    act(() => button.focus())
    expect(document.activeElement).toBe(button)
    act(() => button.click())
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it('keeps the base chip row when selection and expansion are absent', () => {
    act(() => {
      root.render(<TerminalRowButton>Block output</TerminalRowButton>)
    })
    const button = host.querySelector('button')!
    expect(button.className).toBe(ROW_STYLES.row)
    expect(button.hasAttribute('aria-expanded')).toBe(false)
    expect(button.textContent).toBe('Block output')
  })

  it('keeps the running status inline inside a native button', () => {
    const html = renderToStaticMarkup(
      <TerminalRowButton>
        <StatusDisplay isRunning isCanceled={false} formattedDuration='-' />
      </TerminalRowButton>
    )
    expect(html).toMatch(/^<button\b/)
    expect(html).toContain('>Running</span>')
    expect(html).not.toContain('<div')
  })
})
