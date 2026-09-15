/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/auth-client', () => ({ useSession: () => ({ data: null, isPending: false }) }))
vi.mock('@/app/workspace/[workspaceId]/home/components/chat-surface-context', () => ({
  useChatSurface: () => ({ chatId: 'chat' }),
}))
vi.mock('@/hooks/use-smooth-text', () => ({ useSmoothText: (text: string) => text }))

import {
  inlineChatImageUrl,
  isInlineFileReference,
  normalizeInlineFileReference,
} from '@/lib/mothership/chat/inline-image-reference'
import { collectMarkdownImageSources } from '@/lib/mothership/chat/markdown-images'
import { ChatContent } from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/chat-content'

let root: Root
let container: HTMLDivElement
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
async function render(
  content: string,
  imageRequestId: string | undefined = 'request',
  isStreaming = false
) {
  await act(async () =>
    root.render(
      <ChatContent
        content={content}
        messageId='unstable-message-id'
        imageRequestId={imageRequestId}
        isStreaming={isStreaming}
      />
    )
  )
}
describe('standard Markdown private chat images', () => {
  it.each([
    'files/chart.png',
    '/tmp/chart.png',
    'uploads/chart.png',
    'files/my image.png',
    'files/échantillon.png',
    'files/price%.png',
    'files/literal%2520.png',
    'files/chart(1).png',
    '11111111-1111-4111-8111-111111111111',
    'wf_V1StGXR8z5jdHi6BmyT91',
  ])(
    'renders %s through the canonical authenticated endpoint without changing source syntax',
    async (reference) => {
      const markdown = `![Chart](<${reference}>)`
      const astSource = collectMarkdownImageSources(markdown)[0]
      await render(markdown)
      const img = container.querySelector('img')
      expect(img?.getAttribute('src')).toBe(inlineChatImageUrl('chat', 'request', astSource))
      expect(img?.getAttribute('alt')).toBe('Chart')
      const path = new URL(img!.getAttribute('src')!, 'http://localhost').searchParams.get('path')!
      expect(normalizeInlineFileReference(path)).toBe(normalizeInlineFileReference(astSource))
    }
  )
  it.each(['files/' + 'x'.repeat(2100), 'files/\uD800.png', 'files/\u0000.png'])(
    'keeps prose when an image source is malformed',
    async (reference) => {
      await render(`Before ![Bad](<${reference}>) after.`)
      expect(container.textContent).toContain('Before')
      expect(container.textContent).toContain('after.')
      expect(isInlineFileReference(reference)).toBe(false)
      const src = container.querySelector('img')?.getAttribute('src')
      if (src?.startsWith('/api/mothership/chats/')) {
        // CommonMark may replace invalid Unicode before the renderer sees it.
        const path = new URL(src, 'http://localhost').searchParams.get('path')!
        expect(isInlineFileReference(path)).toBe(true)
        expect(normalizeInlineFileReference(path)).toBe(path)
      }
    }
  )

  it('isolates cached Markdown processors across distinct assistant turns', async () => {
    await act(async () =>
      root.render(
        <>
          <ChatContent content='![First](files/same.png)' imageRequestId='first-turn' />
          <ChatContent content='![Second](files/same.png)' imageRequestId='second-turn' />
        </>
      )
    )
    expect(
      [...container.querySelectorAll('img')].map((image) => image.getAttribute('src'))
    ).toEqual([
      inlineChatImageUrl('chat', 'first-turn', 'files/same.png'),
      inlineChatImageUrl('chat', 'second-turn', 'files/same.png'),
    ])
  })
  it('keeps existing remote image rendering', async () => {
    await render('![Remote](https://example.com/chart.png)')
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.com/chart.png'
    )
  })
  it('never displays image syntax inside fenced or inline code', async () => {
    await render('`![Code](/tmp/x.png)`\n\n```markdown\n![Example](files/x.png)\n```')
    expect(container.querySelector('img')).toBeNull()
  })
  it('does not request an incomplete streaming destination', async () => {
    await render('Before ![Chart](files/chart', 'request', true)
    expect(container.querySelector('img')).toBeNull()
    await render('Before ![Chart](files/chart.png)', 'request', true)
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      inlineChatImageUrl('chat', 'request', 'files/chart.png')
    )
  })
  it('keeps the same snapshot URL when live and persisted message IDs differ', async () => {
    await render('![Chart](/tmp/chart.png)')
    const src = container.querySelector('img')?.getAttribute('src')
    await act(async () =>
      root.render(
        <ChatContent
          content='![Chart](/tmp/chart.png)'
          messageId='new-persisted-id'
          imageRequestId='request'
        />
      )
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe(src)
  })
})
