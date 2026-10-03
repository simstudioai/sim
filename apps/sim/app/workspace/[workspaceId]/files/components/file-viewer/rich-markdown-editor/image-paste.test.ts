/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { DOMParser, type Slice } from '@tiptap/pm/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownEditorExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/editor-extensions'
import {
  getImageFileFallback,
  normalizePastedImageSources,
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
