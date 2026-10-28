/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPreview } = vi.hoisted(() => ({ mockPreview: vi.fn() }))
vi.mock('@/lib/browser-agent/open-in-panel', () => ({
  shouldOpenInBrowserPanel: () => false,
  openInBrowserPanel: vi.fn(),
}))
vi.mock('@/lib/integrations/icon-mapping', () => ({ blockTypeToIconMap: {} }))
vi.mock('@/hooks/queries/link-preview', () => ({ useLinkPreview: mockPreview }))

import {
  ExternalLink,
  LinkSourcesContext,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/external-link'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'

const HREF = 'https://docs.example.com/guide'
const SOURCE: SourceTagData = {
  url: HREF,
  title: 'Quarterly plan',
  snippet: 'Authorized source excerpt.',
  connectorType: 'confluence',
}

describe('shared link previews', () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockPreview.mockReset().mockReturnValue({ data: { preview: null } })
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })
  const render = (href = HREF, source?: SourceTagData) =>
    act(() =>
      root.render(
        <LinkSourcesContext.Provider value={new Map(source ? [[href, source]] : [])}>
          <p>
            See <ExternalLink href={href}>the guide</ExternalLink>.
          </p>
        </LinkSourcesContext.Provider>
      )
    )
  const link = () => container.querySelector<HTMLAnchorElement>('a')!
  const preview = () => document.querySelector('[role="dialog"][aria-label="Source preview"]')

  it('uses private source metadata and does not request public-page metadata', () => {
    render(HREF, SOURCE)
    act(() => link().focus())
    expect(mockPreview).toHaveBeenCalledWith(undefined)
    expect(preview()?.textContent).toContain('Quarterly plan')
    expect(preview()?.textContent).toContain('Authorized source excerpt.')
    expect(preview()?.textContent).not.toContain(HREF)
  })
})
