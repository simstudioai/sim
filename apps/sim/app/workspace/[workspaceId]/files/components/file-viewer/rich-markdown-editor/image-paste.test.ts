/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { DOMParser, type Slice } from '@tiptap/pm/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownEditorExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/editor-extensions'
import {
  extractImageFiles,
  getImageFileFallback,
  normalizePastedImageSources,
  resolveImageFileFallback,
  toSameOriginPath,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-paste'

// jsdom lacks `elementFromPoint`; the Placeholder extension's viewport tracking calls it on mount.
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  Element.prototype.scrollIntoView = vi.fn()
  document.elementFromPoint = vi.fn(() => null)
})

function imageFile(name = 'shot.png'): File {
  return new File([''], name, { type: 'image/png' })
}

function transfer(
  files: File[],
  items: Array<{ kind: string; type: string; file: File | null }> = []
): DataTransfer {
  return {
    files,
    items: items.map((entry) => ({
      kind: entry.kind,
      type: entry.type,
      getAsFile: () => entry.file,
    })),
  } as unknown as DataTransfer
}

describe('extractImageFiles', () => {
  it('returns nothing for a null payload or non-image files', () => {
    expect(extractImageFiles(null)).toEqual([])
    expect(extractImageFiles(transfer([new File([''], 'a.txt', { type: 'text/plain' })]))).toEqual(
      []
    )
  })

  it('reads images from the files list (drag-drop)', () => {
    const file = imageFile()
    expect(extractImageFiles(transfer([file]))).toEqual([file])
  })

  it('falls back to items when files is empty (pasted screenshot)', () => {
    const file = imageFile()
    const result = extractImageFiles(transfer([], [{ kind: 'file', type: 'image/png', file }]))
    expect(result).toEqual([file])
  })

  it('ignores non-file and non-image items', () => {
    const result = extractImageFiles(
      transfer(
        [],
        [
          { kind: 'string', type: 'text/plain', file: null },
          { kind: 'file', type: 'application/pdf', file: new File([''], 'a.pdf') },
        ]
      )
    )
    expect(result).toEqual([])
  })
})

describe('normalizePastedImageSources', () => {
  const origin = 'https://editor.example'
  const stored = '/api/files/view/image-a'
  const displayed = '/api/workspaces/workspace-a/files/inline?fileId=image-a'

  function withEditor(test: (editor: Editor, parse: (html: string) => Slice) => void) {
    const editor = new Editor({
      extensions: createMarkdownEditorExtensions({ placeholder: '' }),
      content: `<p>Existing</p><img src="${stored}" width="999" alt="Do not copy these attributes">`,
    })
    const parse = (html: string) => {
      const container = document.createElement('div')
      container.innerHTML = html
      return DOMParser.fromSchema(editor.schema).parseSlice(container)
    }
    try {
      test(editor, parse)
    } finally {
      editor.destroy()
    }
  }

  it.each([
    'blob:https://editor.example/temporary-image',
    '/api/workspaces/source/files/inline?fileId=image',
    '/api/files/public/share/inline?fileId=image',
  ])('resolves a bitmap for repeated non-portable images inside a complete fragment: %s', (src) => {
    withEditor((editor, parse) => {
      const html = (source: string) =>
        `<h2>Heading <img src="${source}" width="120" alt="First"></h2><p><a href="/destination"><img src="${source}" width="240" alt="Second"></a>Caption<img src="/other.png"></p>`
      const slice = parse(html(src))
      const fallback = getImageFileFallback(slice, [imageFile()])
      expect(fallback).not.toBeNull()
      expect(fallback?.source).toBe(src)
      expect(
        resolveImageFileFallback(fallback!, '/api/files/view/uploaded').eq(
          parse(html('/api/files/view/uploaded'))
        )
      ).toBe(true)
      expect(editor.state.doc.textContent).toContain('Existing')
    })
  })

  it('does not associate bitmap bytes with an ambiguous source or file ordering', () => {
    withEditor((_editor, parse) => {
      const twoSources = parse(
        '<p><img src="blob:https://editor.example/a"><img src="blob:https://editor.example/b"></p>'
      )
      expect(getImageFileFallback(twoSources, [imageFile()])).toBeNull()
      expect(
        getImageFileFallback(twoSources, [imageFile('one.png'), imageFile('two.png')])
      ).toBeNull()
      expect(
        getImageFileFallback(parse('<p>Caption<img src="/portable.png"></p>'), [imageFile()])
      ).toBeNull()
    })
  })

  it('preserves the full fragment, image attributes, links and open boundaries', () => {
    withEditor((editor, parse) => {
      const html = (src: string) =>
        '<h2>Heading <img src="' +
        src +
        '" width="120" alt="First"></h2>' +
        '<p><strong>Caption</strong> <a href="/destination"><img src="' +
        src +
        '" width="240" alt="Second"></a> tail</p>' +
        '<p><img src="https://external.example/image.png" alt="External"></p>'
      const slice = parse(html(origin + displayed))
      const result = normalizePastedImageSources(slice, editor.state.doc, () => displayed, origin)
      expect(result.eq(parse(html(stored)))).toBe(true)
      expect(result.openStart).toBe(slice.openStart)
      expect(result.openEnd).toBe(slice.openEnd)
    })
  })

  it('normalizes absolute canonical references without needing a matching document image', () => {
    withEditor((editor, parse) => {
      const slice = parse(`<p>Before <img src="${origin}/api/files/view/image-b"> After</p>`)
      const result = normalizePastedImageSources(slice, editor.state.doc, undefined, origin)
      expect(result.eq(parse('<p>Before <img src="/api/files/view/image-b"> After</p>'))).toBe(true)
    })
  })

  it.each([
    `https://other.example${displayed}`,
    '/api/workspaces/another-workspace/files/inline?fileId=image-a',
    '/api/files/public/another-share/inline?fileId=image-a',
    '/assets/image.png',
  ])('does not infer stored identity from an unfamiliar URL: %s', (src) => {
    withEditor((editor, parse) => {
      const slice = parse(`<img src="${src}">`)
      expect(
        normalizePastedImageSources(slice, editor.state.doc, () => displayed, origin).eq(slice)
      ).toBe(true)
    })
  })

  it('leaves text-only and native stored-image fragments unchanged', () => {
    withEditor((editor, parse) => {
      for (const slice of [parse('<p><em>Text</em></p>'), parse(`<img src="${stored}">`)]) {
        expect(normalizePastedImageSources(slice, editor.state.doc, () => displayed, origin)).toBe(
          slice
        )
      }
    })
  })

  it('does not rewrite a URL in accompanying text', () => {
    withEditor((editor, parse) => {
      const slice = parse(`<p>${displayed}<img src="${origin}${displayed}"></p>`)
      const result = normalizePastedImageSources(slice, editor.state.doc, () => displayed, origin)
      expect(result.eq(parse(`<p>${displayed}<img src="${stored}"></p>`))).toBe(true)
    })
  })
})

describe('toSameOriginPath', () => {
  it('accepts relative and same-origin URLs only', () => {
    expect(toSameOriginPath('/api/files/view/image-a', 'https://editor.example')).toBe(
      '/api/files/view/image-a'
    )
    expect(
      toSameOriginPath('https://editor.example/api/files/view/image-a', 'https://editor.example')
    ).toBe('/api/files/view/image-a')
    expect(
      toSameOriginPath('https://other.example/api/files/view/image-a', 'https://editor.example')
    ).toBeNull()
    expect(toSameOriginPath('data:image/png;base64,AAAA', 'https://editor.example')).toBeNull()
    expect(toSameOriginPath('http://[', 'https://editor.example')).toBeNull()
  })
})
