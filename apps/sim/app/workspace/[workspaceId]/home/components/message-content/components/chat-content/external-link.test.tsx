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
    vi.unstubAllGlobals()
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
  const enter = () =>
    act(() => link().dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))
  const leave = () =>
    act(() => link().dispatchEvent(new MouseEvent('pointerout', { bubbles: true })))

  it('does not load metadata during render or a passing hover', () => {
    render()
    expect(mockPreview).not.toHaveBeenCalled()
    enter()
    act(() => vi.advanceTimersByTime(200))
    leave()
    act(() => vi.advanceTimersByTime(500))
    expect(mockPreview).not.toHaveBeenCalled()
    expect(preview()).toBeNull()
  })

  it('loads public metadata on deliberate hover and preserves navigation', () => {
    mockPreview.mockReturnValue({
      data: {
        preview: {
          title: 'Guide',
          siteName: 'Docs',
          description: 'Useful instructions.',
          image: 'data:image/webp;base64,AAAA',
        },
      },
    })
    render()
    enter()
    act(() => vi.advanceTimersByTime(300))
    expect(mockPreview).toHaveBeenCalledWith(HREF)
    expect(preview()?.textContent).toContain('Useful instructions.')
    expect(preview()?.querySelector('img[src^="data:image/webp"]')).not.toBeNull()
    expect(preview()?.querySelector('a')?.getAttribute('href')).toBe(HREF)
    expect(link().getAttribute('href')).toBe(HREF)
    expect(link().classList).not.toContain('inline-flex')
  })

  it('uses private source metadata and does not request public-page metadata', () => {
    render(HREF, SOURCE)
    act(() => link().focus())
    expect(mockPreview).toHaveBeenCalledWith(undefined)
    expect(preview()?.textContent).toContain('Quarterly plan')
    expect(preview()?.textContent).toContain('Authorized source excerpt.')
    expect(preview()?.textContent).not.toContain(HREF)
  })

  it('keeps a focused preview open on pointer leave and dismisses on Escape', () => {
    render()
    act(() => link().focus())
    leave()
    act(() => vi.advanceTimersByTime(500))
    expect(preview()).not.toBeNull()
    act(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    )
    expect(preview()).toBeNull()
    expect(document.activeElement).toBe(link())
  })

  it('keeps focused preview content open and returns focus on Escape', () => {
    render()
    act(() => link().focus())
    const openLink = preview()!.querySelector<HTMLAnchorElement>('a')!
    act(() => openLink.focus())
    act(() => openLink.dispatchEvent(new MouseEvent('pointerout', { bubbles: true })))
    act(() => vi.advanceTimersByTime(500))
    expect(preview()).not.toBeNull()
    act(() =>
      openLink.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    )
    expect(preview()).toBeNull()
    expect(document.activeElement).toBe(link())
  })

  it('keeps the preview open when focus returns to its anchor', () => {
    render()
    act(() => link().focus())
    act(() => preview()!.querySelector<HTMLAnchorElement>('a')!.focus())
    act(() => link().focus())
    act(() => vi.advanceTimersByTime(500))
    expect(preview()).not.toBeNull()
  })

  it('restores the favicon when a reused link changes hosts after an image error', () => {
    render()
    act(() => link().querySelector('img')!.dispatchEvent(new Event('error')))
    expect(link().querySelector('img')).toBeNull()
    render('https://other.example.com/guide')
    expect(link().querySelector('img')).not.toBeNull()
  })
})
