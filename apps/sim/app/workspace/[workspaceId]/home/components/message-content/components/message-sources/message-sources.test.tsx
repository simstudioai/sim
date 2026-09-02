/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/browser-agent/open-in-panel', () => ({
  shouldOpenInBrowserPanel: () => false,
  openInBrowserPanel: vi.fn(),
}))
vi.mock('@/lib/integrations', () => ({
  blockTypeToIconMap: { confluence_v2: () => <svg data-brand='confluence' /> },
}))

import { MessageSources } from '@/app/workspace/[workspaceId]/home/components/message-content/components/message-sources/message-sources'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(ui: React.ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(ui))
}

function trigger(): HTMLButtonElement {
  const node = container?.querySelector('button')
  if (!node) throw new Error('Sources button did not render')
  return node
}

/** Opens the popover the way a pointer does — Radix opens on `pointerdown` then `click`. */
function open() {
  act(() => {
    trigger().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    trigger().dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
  })
}

function links(): HTMLAnchorElement[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[data-source-link]'))
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('MessageSources', () => {
  it('renders one counted button and lists every source once opened', () => {
    mount(
      <MessageSources
        sources={[
          { url: 'https://docs.github.com/en/a', siteName: 'GitHub Docs', title: 'Docs A' },
          { url: 'https://www.example.com/page' },
        ]}
      />
    )

    expect(trigger().getAttribute('aria-label')).toBe('2 sources')
    expect(trigger().textContent).toBe('2')
    expect(links()).toHaveLength(0)

    open()

    expect(links().map((link) => link.textContent)).toEqual(['Docs A', 'example.com'])
    expect(links().map((link) => link.getAttribute('href'))).toEqual([
      'https://docs.github.com/en/a',
      'https://www.example.com/page',
    ])
    expect(links()[0].getAttribute('target')).toBe('_blank')
  })

  it('shows the connector brand mark when the source names a connector, else the favicon', () => {
    mount(
      <MessageSources
        sources={[
          { url: 'https://x.atlassian.net/wiki/p', connectorType: 'confluence', title: 'Wiki' },
          { url: 'https://docs.github.com/en/a', title: 'Docs' },
        ]}
      />
    )
    open()

    const rows = Array.from(document.querySelectorAll('[data-source-link]')).map(
      (link) => link.parentElement as HTMLElement
    )
    expect(rows[0].querySelector('svg[data-brand="confluence"]')).not.toBeNull()
    expect(rows[0].querySelector('img')).toBeNull()
    expect(rows[1].querySelector('img')?.getAttribute('src')).toContain('docs.github.com')
  })

  it('renders nothing without sources', () => {
    mount(<MessageSources sources={[]} />)
    expect(container?.querySelector('button')).toBeNull()
  })
})
