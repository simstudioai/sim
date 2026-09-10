/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/browser-agent/open-in-panel', () => ({
  shouldOpenInBrowserPanel: () => false,
  openInBrowserPanel: vi.fn(),
}))
vi.mock('@/lib/integrations', () => ({ blockTypeToIconMap: {} }))

import { SourceCard } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card'
import { SourceChip } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-chip'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(ui: React.ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(ui))
  return container
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('citation labels', () => {
  it.each([
    {
      url: 'https://mail.google.com/mail/u/0/#all/thread',
      title: 'Launch checklist',
      siteName: 'Sim Search',
      connectorType: 'gmail',
    },
    {
      url: 'https://example.slack.com/archives/channel/message',
      title: '#engineering — release handoff',
      siteName: 'Slack',
      connectorType: 'slack',
    },
    {
      url: 'https://docs.github.com/page',
      title: 'Managing repositories',
      siteName: 'GitHub Docs',
    },
  ])('uses the retrieved title for $url', (source: SourceTagData) => {
    const view = mount(<SourceChip source={source} />)
    expect(view.querySelector('a')?.textContent).toBe(source.title)
    expect(view.querySelector('a')?.getAttribute('href')).toBe(source.url)
  })

  it.each([
    [{ url: 'https://mail.google.com/thread', title: '  ', siteName: 'Gmail' }, 'Gmail'],
    [{ url: 'https://www.example.com/page' }, 'example.com'],
  ] as const)('keeps a readable fallback without a title', (source, expected) => {
    expect(mount(<SourceChip source={source} />).querySelector('a')?.textContent).toBe(expected)
  })

  it('keeps the provider separate from the source card title', () => {
    const view = mount(
      <SourceCard
        source={{
          url: 'https://mail.google.com/thread',
          title: 'Launch checklist',
          siteName: 'Gmail',
        }}
      />
    )
    expect(view.querySelector('[data-source-link]')?.textContent).toBe('Launch checklist')
    expect(view.textContent?.match(/Launch checklist/g)).toHaveLength(1)
    expect(view.textContent).toContain('Gmail')
  })
})
