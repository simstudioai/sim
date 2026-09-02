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

function chips(): HTMLAnchorElement[] {
  return Array.from(container?.querySelectorAll('a') ?? [])
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('MessageSources', () => {
  it('renders one chip per source with the site name or hostname as its label', () => {
    mount(
      <MessageSources
        sources={[
          { url: 'https://docs.github.com/en/a', siteName: 'GitHub Docs' },
          { url: 'https://www.example.com/page' },
        ]}
      />
    )

    expect(chips().map((chip) => chip.textContent)).toEqual(['GitHub Docs', 'example.com'])
    expect(chips().map((chip) => chip.getAttribute('href'))).toEqual([
      'https://docs.github.com/en/a',
      'https://www.example.com/page',
    ])
    expect(chips()[0].getAttribute('target')).toBe('_blank')
    expect(chips()[0].className).toContain('rounded-full')
  })

  it('shows the connector brand mark when the source names a connector, else the favicon', () => {
    mount(
      <MessageSources
        sources={[
          { url: 'https://wiki.example.com/p', connectorType: 'confluence', title: 'Page' },
          { url: 'https://docs.github.com/en/a', siteName: 'GitHub Docs' },
        ]}
      />
    )

    const [connector, favicon] = chips()
    expect(connector.querySelector('svg[data-brand="confluence"]')).not.toBeNull()
    expect(connector.querySelector('img')).toBeNull()
    expect(favicon.querySelector('img')?.getAttribute('src')).toContain('docs.github.com')
  })

  it('renders nothing without sources', () => {
    mount(<MessageSources sources={[]} />)

    expect(container?.childElementCount).toBe(0)
  })
})
