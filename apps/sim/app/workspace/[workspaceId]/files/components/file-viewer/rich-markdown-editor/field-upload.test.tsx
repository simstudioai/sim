/** @vitest-environment jsdom */
import { act } from 'react'
import type { Editor } from '@tiptap/core'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RichMarkdownField } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-field'

vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/mention',
  () => ({ useEditorMentions: vi.fn() })
)
vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/bubble-menu',
  () => ({ EditorBubbleMenu: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/link-hover-card',
  () => ({ LinkHoverCard: () => null })
)

let host: HTMLDivElement
let root: Root
let onChange: ReturnType<typeof vi.fn>
let upload: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  onChange = vi.fn()
  upload = vi.fn()
})
afterEach(async () => {
  await act(async () => root.unmount())
  await vi.advanceTimersByTimeAsync(10)
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
async function render(
  value = 'before TARGET after',
  disabled = false,
  streaming = false,
  identity = 'initial'
) {
  await act(async () =>
    root.render(
      <RichMarkdownField
        key={identity}
        value={value}
        disabled={disabled}
        isStreaming={streaming}
        onChange={onChange}
        uploadImage={upload}
      />
    )
  )
  await act(async () => vi.advanceTimersByTimeAsync(10))
}
function editor() {
  return host.querySelector<HTMLElement & { editor: Editor }>('.tiptap')!.editor
}
async function submit(
  method: 'paste' | 'drop',
  target: Editor,
  files = [new File(['image'], 'image.png', { type: 'image/png' })],
  selection: number | { from: number; to: number } = 8
) {
  await act(async () => target.commands.setTextSelection(selection))
  if (method === 'drop') vi.spyOn(target.view, 'posAtCoords').mockReturnValue({ pos: 8, inside: 0 })
  const transfer = { files, items: [], types: ['Files'], getData: () => '' }
  const event = new Event(method, { bubbles: true, cancelable: true })
  Object.defineProperty(event, method === 'paste' ? 'clipboardData' : 'dataTransfer', {
    value: transfer,
  })
  Object.defineProperties(event, { clientX: { value: 0 }, clientY: { value: 0 } })
  await act(async () => target.view.dom.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(true)
  expect(upload).toHaveBeenCalledTimes(1)
}

describe('field upload completion boundary', () => {
  it.each(['paste', 'drop'] as const)(
    '%s uploads a non-portable image without losing its accompanying fragment',
    async (method) => {
      const pending = Promise.withResolvers<{ url: string; alt: string }>()
      upload.mockReturnValueOnce(pending.promise)
      await render()
      const owner = editor()
      const before = owner.getJSON()
      await act(async () => owner.commands.setTextSelection({ from: 8, to: 14 }))
      if (method === 'drop')
        vi.spyOn(owner.view, 'posAtCoords').mockReturnValue({ pos: 8, inside: 0 })
      const html =
        '<p>Lead</p><h2>Caption</h2><p><a href="/destination"><img src="/api/workspaces/source/files/inline?fileId=image" alt="Original alt" width="123"></a><strong>Tail</strong><img src="/other.png" alt="Other"></p>'
      const event = new MouseEvent(method, { bubbles: true, cancelable: true })
      Object.defineProperty(event, method === 'paste' ? 'clipboardData' : 'dataTransfer', {
        value: {
          files: [new File(['image'], 'image.png', { type: 'image/png' })],
          items: [],
          types: ['Files', 'text/html'],
          getData: (type: string) => (type === 'text/html' ? html : ''),
        },
      })
      await act(async () => owner.view.dom.dispatchEvent(event))
      expect(upload).toHaveBeenCalledOnce()
      expect(owner.getJSON()).toEqual(before)
      await act(async () => owner.commands.insertContentAt(1, 'prefix '))
      await act(async () => pending.resolve({ url: '/api/files/view/uploaded', alt: 'New alt' }))
      expect(owner.state.doc.textContent).toBe(
        method === 'paste'
          ? 'prefix before LeadCaptionTail after'
          : 'prefix before LeadCaptionTailTARGET after'
      )
      expect(host.querySelector('h2')?.textContent).toBe('Caption')
      expect(host.querySelector('strong')?.textContent).toBe('Tail')
      expect(host.querySelector('a')?.getAttribute('href')).toBe('/destination')
      expect(
        Array.from(host.querySelectorAll('img')).map((image) => image.getAttribute('src'))
      ).toEqual(['/api/files/view/uploaded', '/other.png'])
      expect(host.querySelector('img')?.getAttribute('alt')).toBe('Original alt')
      expect(owner.getMarkdown()).toContain('width="123"')
      expect(owner.getMarkdown()).not.toContain('/inline?')
      expect(() => owner.state.doc.check()).not.toThrow()
    }
  )

  it('replaces the selected range only after a pasted image finishes uploading', async () => {
    const pending = Promise.withResolvers<{ url: string; alt: string }>()
    upload.mockReturnValueOnce(pending.promise)
    await render()
    const owner = editor()
    const before = owner.getJSON()
    await submit('paste', owner, undefined, { from: 8, to: 14 })
    expect(owner.getJSON()).toEqual(before)
    await act(async () =>
      pending.resolve({ url: 'https://sim.ai/replacement.png', alt: 'Replacement' })
    )
    expect(owner.state.doc.textContent).toBe('before  after')
    expect(host.querySelectorAll('img')).toHaveLength(1)
    await act(async () => owner.commands.undo())
    expect(owner.getJSON()).toEqual(before)
  })

  it.each(['paste', 'drop'] as const)(
    '%s preserves the whole HTML slice when the payload also contains a bitmap file',
    async (method) => {
      await render()
      const owner = editor()
      await act(async () => owner.commands.setTextSelection({ from: 8, to: 14 }))
      if (method === 'drop')
        vi.spyOn(owner.view, 'posAtCoords').mockReturnValue({ pos: 8, inside: 0 })
      const html =
        '<p>Lead</p><h2>Caption</h2><p><a href="https://sim.ai/link"><img src="https://sim.ai/one.png" alt="One" width="123"></a>Tail<img src="https://sim.ai/two.png" alt="Two" width="234"></p>'
      const transfer = {
        files: [new File(['image'], 'image.png', { type: 'image/png' })],
        items: [],
        types: ['text/html', 'text/plain', 'Files'],
        getData: (type: string) =>
          type === 'text/html' ? html : type === 'text/plain' ? 'CaptionTail' : '',
      }
      const event = new MouseEvent(method, { bubbles: true, cancelable: true })
      Object.defineProperty(event, method === 'paste' ? 'clipboardData' : 'dataTransfer', {
        value: transfer,
      })
      await act(async () => owner.view.dom.dispatchEvent(event))
      expect(event.defaultPrevented).toBe(true)
      expect(upload).not.toHaveBeenCalled()
      expect(host.querySelector('h2')?.textContent).toBe('Caption')
      expect(owner.state.doc.textContent).toContain('Tail')
      expect(Array.from(host.querySelectorAll('img')).map((image) => image.alt)).toEqual([
        'One',
        'Two',
      ])
      const images: Array<{ src: string; width: string; href: string | null }> = []
      owner.state.doc.descendants((node) => {
        if (node.type.name === 'image' || node.type.name === 'inlineImage') {
          images.push({ src: node.attrs.src, width: node.attrs.width, href: node.attrs.href })
        }
      })
      expect(images).toEqual([
        { src: 'https://sim.ai/one.png', width: '123', href: 'https://sim.ai/link' },
        { src: 'https://sim.ai/two.png', width: '234', href: null },
      ])
      expect(() => owner.state.doc.check()).not.toThrow()
    }
  )

  it('invalidates an upload even when streaming ends before completion', async () => {
    const pending = Promise.withResolvers<{ url: string; alt: string }>()
    upload.mockReturnValueOnce(pending.promise)
    await render()
    const owner = editor()
    await submit('paste', owner)
    await render('replacement streamed content', false, true)
    await render('replacement streamed content')
    expect(owner.isEditable).toBe(true)
    const before = owner.getJSON()
    onChange.mockClear()
    await act(async () => pending.resolve({ url: 'https://sim.ai/late.png', alt: 'Late' }))
    expect(owner.getJSON()).toEqual(before)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('maps an upload anchor through edits without showing upload controls', async () => {
    const pending = Promise.withResolvers<{ url: string; alt: string }>()
    upload.mockReturnValueOnce(pending.promise)
    await render()
    const owner = editor()
    await submit('paste', owner)
    expect(host.querySelector('[data-image-upload-placeholder]')).toBeNull()
    await act(async () => owner.commands.insertContentAt(1, 'new prefix '))
    await act(async () => pending.resolve({ url: 'https://sim.ai/mapped.png', alt: 'Mapped' }))
    expect(owner.getJSON().content?.map((node) => node.type)).toEqual([
      'paragraph',
      'image',
      'paragraph',
    ])
    expect(owner.getJSON().content?.[0].content?.[0].text).toBe('new prefix before ')
    expect(owner.getJSON().content?.[2].content?.[0].text).toBe('TARGET after')
  })

  it('does not insert after the upload anchor is deleted', async () => {
    const pending = Promise.withResolvers<{ url: string; alt: string }>()
    upload.mockReturnValueOnce(pending.promise)
    await render()
    const owner = editor()
    await submit('paste', owner)
    await act(async () => owner.commands.deleteRange({ from: 1, to: 15 }))
    const before = owner.getJSON()
    await act(async () => pending.resolve({ url: 'https://sim.ai/deleted.png', alt: 'Deleted' }))
    expect(owner.getJSON()).toEqual(before)
  })

  it('keeps successful images in batch order when another upload fails', async () => {
    const first = Promise.withResolvers<{ url: string; alt: string }>()
    const last = Promise.withResolvers<{ url: string; alt: string }>()
    upload
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockReturnValueOnce(last.promise)
    await render()
    const owner = editor()
    await submit(
      'paste',
      owner,
      ['first', 'failed', 'last'].map(
        (name) => new File(['image'], `${name}.png`, { type: 'image/png' })
      )
    )
    await act(async () => first.resolve({ url: 'https://sim.ai/first.png', alt: 'First' }))
    await act(async () => last.resolve({ url: 'https://sim.ai/last.png', alt: 'Last' }))
    expect(
      Array.from(host.querySelectorAll('img')).map((image) => image.getAttribute('alt'))
    ).toEqual(['First', 'Last'])
    expect(upload).toHaveBeenCalledTimes(3)
  })

  it.each(
    (['paste', 'drop'] as const).flatMap((method) =>
      (['disabled', 'streaming', 'unmount', 'identity', 'rejection'] as const).map((action) => ({
        method,
        action,
      }))
    )
  )(
    '$method result after $action cannot change the current document',
    async ({ method, action }) => {
      const pending = Promise.withResolvers<{ url: string; alt: string } | null>()
      upload.mockReturnValueOnce(pending.promise)
      await render()
      const original = editor()
      await submit(method, original)
      if (action === 'disabled') await render('before TARGET after', true)
      else if (action === 'streaming') await render('replacement streamed content', false, true)
      else if (action === 'unmount') {
        await act(async () => root.render(null))
        await act(async () => vi.advanceTimersByTimeAsync(10))
      } else if (action === 'identity') await render('new identity content', false, false, 'next')
      const current = action === 'unmount' ? original : editor()
      const before = current.getJSON()
      onChange.mockClear()
      await act(async () => {
        if (action === 'rejection') pending.reject(new Error('late upload failure'))
        else pending.resolve({ url: 'https://sim.ai/completed.png', alt: 'Uploaded image' })
      })
      expect(current.getJSON()).toEqual(before)
      expect(onChange).not.toHaveBeenCalled()
      if (action === 'disabled' || action === 'streaming') expect(current.isEditable).toBe(false)
      if (action === 'unmount') expect(original.isDestroyed).toBe(true)
      if (action === 'identity') expect(current).not.toBe(original)
    }
  )
  it.each(['paste', 'drop'] as const)(
    '%s successful completion inserts into an unchanged editable host',
    async (method) => {
      const pending = Promise.withResolvers<{ url: string; alt: string }>()
      upload.mockReturnValueOnce(pending.promise)
      await render()
      const owner = editor()
      await submit(method, owner)
      await act(async () => pending.resolve({ url: 'https://sim.ai/success.png', alt: 'Success' }))
      expect(host.querySelector('img')?.getAttribute('src')).toBe('https://sim.ai/success.png')
      expect(onChange).toHaveBeenCalledOnce()
    }
  )
})
