/** @vitest-environment jsdom */
import { expect, it, vi } from 'vitest'
import { buildHtmlPreviewDocument } from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-panel'

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
