/** @vitest-environment jsdom */

import { act, createElement } from 'react'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import {
  buildHtmlPreviewDocument,
  PreviewPanel,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-panel'

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }))
vi.mock('@/hooks/queries/workspace-files', () => ({
  useWorkspaceFileBinary: () => ({ data: undefined }),
}))

it('keeps fragment navigation local, decodes targets and preserves external handoff', () => {
  const html = buildHtmlPreviewDocument('<html><head></head><body></body></html>')
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  expect(script).toBeDefined()
  document.body.innerHTML =
    '<a href="#section">Section</a><section id="section" tabindex="-1"></section><a href="#long%20name">Encoded</a><section id="long name" tabindex="-1"></section><a href="#missing">Missing</a><a href="https://example.com/help">External</a>'
  const localLocation = { hash: '' }
  const scroll = vi.fn()
  const handoff = vi.fn()
  const listeners: Array<[string, EventListener]> = []
  const scopedDocument = {
    getElementById: document.getElementById.bind(document),
    addEventListener: (name: string, listener: EventListener) => listeners.push([name, listener]),
  }
  for (const section of document.querySelectorAll('section')) section.scrollIntoView = scroll
  new Function('document', 'location', 'Element', 'HTMLAnchorElement', 'parent', script!)(
    scopedDocument,
    localLocation,
    Element,
    HTMLAnchorElement,
    { postMessage: handoff }
  )
  const click = listeners.find(([name]) => name === 'click')![1]
  for (const [index, hash, focused] of [
    [0, '#section', 'section'],
    [1, '#long%20name', 'long name'],
    [2, '#missing', 'long name'],
  ] as const) {
    const event = new MouseEvent('click', { cancelable: true })
    Object.defineProperty(event, 'target', { value: document.querySelectorAll('a')[index] })
    click(event)
    expect(event.defaultPrevented).toBe(true)
    expect(localLocation.hash).toBe(hash)
    expect(document.activeElement?.id).toBe(focused)
  }
  expect(scroll).toHaveBeenCalledTimes(2)
  expect(handoff).not.toHaveBeenCalled()
  const event = new MouseEvent('click', { cancelable: true })
  Object.defineProperty(event, 'target', { value: document.querySelectorAll('a')[3] })
  click(event)
  expect(event.defaultPrevented).toBe(true)
  expect(handoff).toHaveBeenCalledWith({ __simPageNav: 'https://example.com/help' }, '*')
})

it('honors navigation handoffs only from its own preview frame', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 800, 600)
  )
  const openTab = vi.spyOn(window, 'open').mockReturnValue(null)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(PreviewPanel, {
        content: '<p>page</p>',
        mimeType: 'text/html',
        filename: 'page.html',
        workspaceId: 'ws-1',
        fileId: 'file-1',
        fileKey: 'page.html',
      })
    )
  })
  const frameWindow = container.querySelector('iframe')?.contentWindow
  if (!frameWindow) throw new Error('preview frame did not mount')
  const routerPush = nextNavigationMockFns.router.push

  const post = (href: string, source: MessageEventSource | null) =>
    window.dispatchEvent(new MessageEvent('message', { data: { __simPageNav: href }, source }))

  const foreignWindow = document.createElement('iframe')
  document.body.append(foreignWindow)
  post('https://attacker.example/login', foreignWindow.contentWindow)
  post('https://attacker.example/login', null)
  post('/workspace/victim/files', window)
  expect(openTab).not.toHaveBeenCalled()
  expect(routerPush).not.toHaveBeenCalled()

  post('https://example.com/help', frameWindow)
  post('/workspace/ws-1/files', frameWindow)
  expect(openTab).toHaveBeenCalledWith('https://example.com/help', '_blank', 'noopener,noreferrer')
  expect(routerPush).toHaveBeenCalledWith('/workspace/ws-1/files')

  await act(async () => root.unmount())
})
