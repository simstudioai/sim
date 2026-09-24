/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { BlockTileView } from '@sim/workflow-renderer'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  StatusDisplay,
  TerminalRowButton,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/components'
import { ROW_STYLES } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/types'

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
    expect(button.getAttribute('aria-current')).toBe('true')
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
    expect(button.hasAttribute('aria-current')).toBe(false)
    expect(button.textContent).toBe('Block output')
  })

  it('does not mark an unselected output row as current', () => {
    act(() => {
      root.render(<TerminalRowButton selected={false}>Other output</TerminalRowButton>)
    })
    expect(host.querySelector('button')?.hasAttribute('aria-current')).toBe(false)
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

  it('keeps the complete tile, label, chevron, and status as valid button contents', () => {
    const Icon = ({ className }: { className?: string }) => <svg className={className} />
    const html = renderToStaticMarkup(
      <TerminalRowButton aria-expanded={false}>
        <span className={ROW_STYLES.content}>
          <BlockTileView as='span' blockType='agent' icon={Icon} bgColor='#33C482' useAccent />
          <span className={ROW_STYLES.label}>Agent</span>
          <svg aria-hidden='true' />
        </span>
        <span className={ROW_STYLES.status}>
          <StatusDisplay isRunning isCanceled={false} formattedDuration='-' />
        </span>
      </TerminalRowButton>
    )
    const document = new DOMParser().parseFromString(html, 'text/html')
    const button = document.querySelector('button')
    expect(button?.getAttribute('aria-expanded')).toBe('false')
    expect(button?.textContent).toContain('Agent')
    expect(button?.textContent).toContain('Running')
    expect(button?.querySelector('[data-workflow-type-icon="agent"]')).not.toBeNull()
    expect(button?.querySelectorAll('button, a, div')).toHaveLength(0)
    expect(document.body.children).toHaveLength(1)
  })
})
