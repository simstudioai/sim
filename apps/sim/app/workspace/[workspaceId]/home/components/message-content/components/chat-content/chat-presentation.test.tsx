/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/auth-client', () => ({ useSession: () => ({ data: null, isPending: false }) }))
vi.mock('@/hooks/use-smooth-text', () => ({ useSmoothText: (text: string) => text }))
vi.mock('@/hooks/queries/link-preview', () => ({
  useLinkPreview: () => ({ data: { preview: null } }),
}))
vi.mock('@/lib/browser-agent/open-in-panel', () => ({
  shouldOpenInBrowserPanel: () => false,
  openInBrowserPanel: vi.fn(),
}))

import { ChatContent } from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/chat-content'

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal(
    'matchMedia',
    vi
      .fn()
      .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render(content: string) {
  await act(async () => root.render(<ChatContent content={content} />))
}

describe('mixed chat presentation', () => {
  it('preserves full table content and gives links their own preview without competing tooltips', async () => {
    const source = JSON.stringify({
      url: 'https://example.com/review',
      title: 'Release review',
      connectorType: 'confluence',
    })
    await render(
      `| Document | Status | Notes |\n| :--- | :---: | ---: |\n| **A long document title** | Ready | [Read *the guide*](https://example.com/guide) and \`search workspace\` |\n| Review | Done | <source>${source}</source> |`
    )
    expect(container.querySelectorAll('th')).toHaveLength(3)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    expect([...container.querySelectorAll('th')].map((cell) => cell.style.textAlign)).toEqual([
      'left',
      'center',
      'right',
    ])
    expect(container.querySelector('td [data-streamdown="strong"]')?.textContent).toBe(
      'A long document title'
    )
    expect(container.querySelector('td')?.querySelector('[data-overflow-text]')).toBeNull()
    expect(container.querySelector('td code')?.textContent).toBe('search workspace')
    expect(container.querySelector('td a[href="https://example.com/guide"] em')?.textContent).toBe(
      'the guide'
    )
    const citation = container.querySelector<HTMLAnchorElement>(
      'td a[href="https://example.com/review"]'
    )!
    expect(citation.closest('[data-overflow-text]')).toBeNull()
    expect(
      container
        .querySelector('td a[href="https://example.com/guide"]')
        ?.closest('[data-overflow-text]')
    ).toBeNull()
    expect(citation.textContent).toBe('Release review')
    act(() => citation.focus())
    expect(
      document.querySelector('[role="dialog"][aria-label="Source preview"]')?.textContent
    ).toContain('Release review')
  })

  it('keeps nested task content and marked link text without losing list semantics', async () => {
    await render(
      '- [x] **Parent** task\n  - Nested bullet with [**bold** *italic* ~~removed~~ `code`](https://example.com/guide)\n  - [ ] Nested task\n\n- [ ] Loose task\n\n  A second paragraph.'
    )
    expect(container.querySelectorAll('ul ul').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('[role="checkbox"]')).toHaveLength(3)
    const link = container.querySelector('a[href="https://example.com/guide"]')!
    expect(link.querySelector('[data-streamdown="strong"]')?.textContent).toBe('bold')
    expect(link.querySelector('em')?.textContent).toBe('italic')
    expect(link.querySelector('del')?.textContent).toBe('removed')
    expect(link.querySelector('code')?.textContent).toBe('code')
    expect(container.textContent).toContain('A second paragraph.')
  })
})
