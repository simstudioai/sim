/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPreview } = vi.hoisted(() => ({ mockPreview: vi.fn() }))

vi.mock('@/lib/browser-agent/open-in-panel', () => ({
  shouldOpenInBrowserPanel: () => false,
  openInBrowserPanel: vi.fn(),
}))
vi.mock('@/hooks/queries/link-preview', () => ({
  useLinkPreview: () => ({ data: { preview: mockPreview() } }),
}))

import {
  ExternalLink,
  getExternalLinkTooltip,
  LinkSourcesContext,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/external-link'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'

const HREF = 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQ'
const PREVIEW = { title: 'Preview title', description: 'Preview description', siteName: 'Gmail' }
const SOURCE: SourceTagData = { url: HREF, title: 'Quarterly plan thread', siteName: 'Gmail' }

describe('getExternalLinkTooltip', () => {
  it('prefers the cited source title, then the preview title, then the site name', () => {
    expect(getExternalLinkTooltip(HREF, SOURCE, PREVIEW)).toMatchObject({
      title: 'Quarterly plan thread',
      siteName: 'Gmail',
    })
    expect(getExternalLinkTooltip(HREF, undefined, PREVIEW)).toMatchObject({
      title: 'Preview title',
      siteName: 'Gmail',
      description: 'Preview description',
    })
    expect(getExternalLinkTooltip(HREF, undefined, undefined)).toEqual({
      title: 'mail.google.com',
    })
    expect(getExternalLinkTooltip('https://www.example.com/a', undefined, null)).toEqual({
      title: 'example.com',
    })
  })

  it('never shows the raw URL, and takes a description only from the preview', () => {
    for (const tooltip of [
      getExternalLinkTooltip(HREF, SOURCE, undefined),
      getExternalLinkTooltip(
        HREF,
        { url: HREF },
        { title: ' ', description: null, siteName: null }
      ),
      getExternalLinkTooltip(HREF, undefined, undefined),
    ]) {
      expect(Object.values(tooltip)).not.toContain(HREF)
      expect(tooltip.description).toBeUndefined()
    }
  })
})

describe('ExternalLink', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockPreview.mockReturnValue(null)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const render = (sources: ReadonlyMap<string, SourceTagData> = new Map()) =>
    act(() =>
      root.render(
        <LinkSourcesContext.Provider value={sources}>
          <p>
            See the{' '}
            <ExternalLink href={HREF} hostname='mail.google.com'>
              Conversation
            </ExternalLink>
          </p>
        </LinkSourcesContext.Provider>
      )
    )
  const link = () => container.querySelector('a')!
  const hover = () =>
    act(() => {
      link().dispatchEvent(new MouseEvent('pointerover', { bubbles: true, clientX: 9, clientY: 9 }))
    })

  it('centers the favicon on the text middle without a pixel offset or an inline-flex link', () => {
    render()
    const icon = link().querySelector('img')!
    expect(icon.classList).toContain('align-middle')
    expect(icon.parentElement).toBe(link())
    const offsets = [...icon.classList].filter((name) => /^(-?top|relative|translate)/.test(name))
    expect(offsets).toEqual([])
    expect(link().classList).not.toContain('inline-flex')
  })

  it('underlines only on hover, with no fill, and keeps the keyboard focus outline', () => {
    render()
    const classes = [...link().classList]
    expect(classes).toContain('no-underline')
    expect(classes).toContain('hover:underline')
    expect(classes).toContain('decoration-[var(--text-muted)]')
    expect(classes.some((name) => name.startsWith('hover:bg-'))).toBe(false)
    expect(classes).toContain('focus-visible:outline')
  })

  it('titles the tooltip with the cited source for this exact URL', () => {
    render(new Map([[HREF, SOURCE]]))
    hover()
    const tooltip = document.querySelector('[role="tooltip"]')!
    expect(tooltip.textContent).toContain('Quarterly plan thread')
    expect(tooltip.textContent).toContain('Gmail')
    expect(tooltip.textContent).not.toContain(HREF)
  })

  it('falls back to the site name instead of the URL for a private page with no preview', () => {
    render()
    hover()
    const tooltip = document.querySelector('[role="tooltip"]')!
    expect(tooltip.textContent).toContain('mail.google.com')
    expect(tooltip.textContent).not.toContain(HREF)
  })
})
