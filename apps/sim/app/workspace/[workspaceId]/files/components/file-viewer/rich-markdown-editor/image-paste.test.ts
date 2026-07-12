/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractEmbeddedFileRef } from '@/lib/uploads/utils/embedded-image-ref'
import {
  createPublicFileContentSource,
  createWorkspaceFileContentSource,
} from '@/hooks/use-file-content-source'
import { createMarkdownEditorExtensions } from './editor-extensions'
import {
  extractImageFiles,
  extractImgSrcs,
  findHostedImageAttrs,
  hasHostedImageHtml,
  htmlReferencesSrc,
  isInlineRouteSrc,
  shouldSkipFileUpload,
  toSameOriginPath,
} from './image-paste'

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

describe('hasHostedImageHtml', () => {
  const isHosted = (src: string) => src.startsWith('/api/files/view/')

  it('detects an <img> whose src is recognized as one of our own hosted files', () => {
    expect(hasHostedImageHtml('<img src="/api/files/view/wf_abc" alt="x">', isHosted)).toBe(true)
  })

  it('is false when the html has no img, or the img src is not one of ours', () => {
    expect(hasHostedImageHtml('<p>hello</p>', isHosted)).toBe(false)
    expect(hasHostedImageHtml('<img src="https://other-site.com/photo.jpg">', isHosted)).toBe(false)
    expect(hasHostedImageHtml('', isHosted)).toBe(false)
  })

  it('matches a hosted img among multiple candidates', () => {
    expect(
      hasHostedImageHtml(
        '<img src="https://other-site.com/a.png"><img src="/api/files/view/wf_abc">',
        isHosted
      )
    ).toBe(true)
  })

  // Regression: the browser doesn't put the node's persisted `attrs.src` (`/api/files/view/...`)
  // onto the clipboard when a rendered <img> is copied — it puts the actual DOM `src`, which is
  // `resolveImageSrc`'s REWRITTEN display URL (`/…/files/inline?key=…`/`?fileId=…`). A predicate
  // that only recognizes the persisted shape (as `extractEmbeddedFileRef` alone does) never matches
  // a real same-page copy, silently falling through to the re-upload path it exists to avoid.
  it('recognizes the real rendered <img src> end-to-end, not just the persisted reference shape', () => {
    const ws = createWorkspaceFileContentSource('ws-1')
    const renderedFromKey = ws.resolveImageSrc(
      '/api/files/serve/workspace/ws-1/1700000000000-deadbeefdeadbeef-photo.png'
    )
    const renderedFromFileId = ws.resolveImageSrc('/api/files/view/wf_abc')
    expect(renderedFromKey).toMatch(/^\/api\/workspaces\/ws-1\/files\/inline\?key=/)
    expect(renderedFromFileId).toBe('/api/workspaces/ws-1/files/inline?fileId=wf_abc')

    // extractEmbeddedFileRef alone (the persisted-content recognizer) does NOT match either
    // rendered form — that's the exact gap isInlineRouteSrc closes.
    expect(extractEmbeddedFileRef(renderedFromKey as string)).toBeNull()
    expect(extractEmbeddedFileRef(renderedFromFileId as string)).toBeNull()

    const isHostedReal = (src: string) => extractEmbeddedFileRef(src) !== null
    expect(hasHostedImageHtml(`<img src="${renderedFromKey}">`, isHostedReal)).toBe(true)
    expect(hasHostedImageHtml(`<img src="${renderedFromFileId}">`, isHostedReal)).toBe(true)
  })

  it('recognizes the public-share inline route too', () => {
    const pub = createPublicFileContentSource('tok_1', '/api/files/public/tok_1/content')
    const rendered = pub.resolveImageSrc('/api/files/view/wf_abc')
    expect(rendered).toBe('/api/files/public/tok_1/inline?fileId=wf_abc')
    expect(hasHostedImageHtml(`<img src="${rendered}">`, () => false)).toBe(true)
  })

  it('matches a valid unquoted src attribute (unquoted attribute values are valid HTML)', () => {
    expect(hasHostedImageHtml('<img src=/api/files/view/wf_abc>', isHosted)).toBe(true)
    expect(hasHostedImageHtml("<img alt='x' src=/api/files/view/wf_abc alt=y>", isHosted)).toBe(
      true
    )
    expect(hasHostedImageHtml('<img src=https://other-site.com/a.png>', isHosted)).toBe(false)
  })

  it('matches single-quoted src attributes too', () => {
    expect(hasHostedImageHtml("<img src='/api/files/view/wf_abc'>", isHosted)).toBe(true)
  })
})

describe('extractImgSrcs', () => {
  it('extracts every img src in document order, including duplicates', () => {
    expect(
      extractImgSrcs('<img src="/a.png"><p>text</p><img src="/b.png"><img src="/a.png">')
    ).toEqual(['/a.png', '/b.png', '/a.png'])
  })

  it('returns an empty array for html with no img', () => {
    expect(extractImgSrcs('<p>hello</p>')).toEqual([])
    expect(extractImgSrcs('')).toEqual([])
  })
})

describe('shouldSkipFileUpload (shared by paste and drop)', () => {
  const isHosted = (src: string) => src.startsWith('/api/files/view/')
  const hostedHtml = '<img src="/api/files/view/wf_abc">'

  it('skips upload for a single already-hosted image', () => {
    expect(shouldSkipFileUpload([imageFile()], hostedHtml, isHosted)).toBe(true)
  })

  it('does not skip when there is no html, or the html is not one of ours', () => {
    expect(shouldSkipFileUpload([imageFile()], '', isHosted)).toBe(false)
    expect(shouldSkipFileUpload([imageFile()], '<img src="https://x.com/a.png">', isHosted)).toBe(
      false
    )
  })

  it('does not skip when there are no files to upload in the first place', () => {
    expect(shouldSkipFileUpload([], hostedHtml, isHosted)).toBe(false)
  })

  // Regression: a genuinely mixed paste/drop (the hosted image plus a separate new one) must
  // still upload the new file — bailing out entirely here would silently drop it.
  it('does not skip a mixed paste/drop carrying more than one image file', () => {
    expect(
      shouldSkipFileUpload([imageFile('a.png'), imageFile('b.png')], hostedHtml, isHosted)
    ).toBe(false)
  })

  // Regression: this must be content-based (the accompanying html), not keyed off any mutable
  // per-drag flag like ProseMirror's `view.dragging` — that flag can go briefly stale (cleared up
  // to ~50ms late via `dragend` when a prior internal drag was dropped outside the view), and a
  // flag-based check would incorrectly suppress upload of an unrelated new file dropped in that
  // window. This function only reacts to what THIS specific event's `html`/`images` contain.
  it('is a pure function of the images/html actually offered, independent of any drag-session flag', () => {
    expect(shouldSkipFileUpload([imageFile()], '', isHosted)).toBe(false)
    expect(shouldSkipFileUpload([imageFile()], hostedHtml, isHosted)).toBe(true)
  })
})

describe('isInlineRouteSrc', () => {
  it('recognizes the workspace- and public-scoped inline route with key or fileId', () => {
    expect(isInlineRouteSrc('/api/workspaces/ws-1/files/inline?key=workspace%2Fws-1%2Fa.png')).toBe(
      true
    )
    expect(isInlineRouteSrc('/api/workspaces/ws-1/files/inline?fileId=wf_abc')).toBe(true)
    expect(isInlineRouteSrc('/api/files/public/tok_1/inline?fileId=wf_abc')).toBe(true)
  })

  it('rejects non-inline paths, unrecognized query params, and external/absolute origins', () => {
    expect(isInlineRouteSrc('/api/files/serve/workspace/ws-1/a.png')).toBe(false)
    expect(isInlineRouteSrc('/api/workspaces/ws-1/files/inline')).toBe(false)
    expect(isInlineRouteSrc('/api/workspaces/ws-1/files/inline?other=1')).toBe(false)
    expect(isInlineRouteSrc('https://other-site.com/files/inline?key=x')).toBe(false)
    expect(isInlineRouteSrc('data:image/png;base64,aaaa')).toBe(false)
  })
})

describe('findHostedImageAttrs', () => {
  const ws = createWorkspaceFileContentSource('ws-1')

  function docWithImages(...attrs: Array<Record<string, unknown>>): Editor {
    return new Editor({
      extensions: createMarkdownEditorExtensions({ placeholder: '' }),
      content: {
        type: 'doc',
        content: attrs.map((a) => ({ type: 'image', attrs: a })),
      },
    })
  }

  // Regression: this is the exact mechanism that avoids persisting the display-layer inline URL
  // (Cursor's "Paste persists display image URLs" finding) — cloning the REAL node's attrs rather
  // than re-deriving a node from the clipboard html's rewritten src.
  it('finds the existing node whose RESOLVED (display) src matches, and returns its REAL persisted attrs', () => {
    const persistedSrc = '/api/files/view/wf_abc'
    const editor = docWithImages({ src: persistedSrc, alt: 'photo', width: '300' })
    const renderedSrc = ws.resolveImageSrc(persistedSrc) as string
    expect(renderedSrc).not.toBe(persistedSrc) // sanity: the rendered form really differs

    const match = findHostedImageAttrs(editor.state.doc, [renderedSrc], ws.resolveImageSrc)
    expect(match).not.toBeNull()
    expect(match?.src).toBe(persistedSrc) // the REAL persisted src, not the rendered one
    expect(match?.alt).toBe('photo')
    expect(match?.width).toBe('300')
  })

  it('returns null when no node in the doc resolves to any target src', () => {
    const editor = docWithImages({ src: '/api/files/view/wf_other' })
    const match = findHostedImageAttrs(
      editor.state.doc,
      ['/api/workspaces/ws-1/files/inline?fileId=wf_abc'],
      ws.resolveImageSrc
    )
    expect(match).toBeNull()
  })

  it('returns null for an empty doc or an empty target list', () => {
    const editor = docWithImages()
    expect(findHostedImageAttrs(editor.state.doc, ['/anything'], ws.resolveImageSrc)).toBeNull()
    const editorWithImage = docWithImages({ src: '/api/files/view/wf_abc' })
    expect(findHostedImageAttrs(editorWithImage.state.doc, [], ws.resolveImageSrc)).toBeNull()
  })

  it('matches the first of several images, not just the last', () => {
    const editor = docWithImages(
      { src: '/api/files/view/wf_one', alt: 'one' },
      { src: '/api/files/view/wf_two', alt: 'two' }
    )
    const renderedTwo = ws.resolveImageSrc('/api/files/view/wf_two') as string
    const match = findHostedImageAttrs(editor.state.doc, [renderedTwo], ws.resolveImageSrc)
    expect(match?.alt).toBe('two')
  })

  it('returns a defensive copy, not a live reference to the node attrs object', () => {
    const persistedSrc = '/api/files/view/wf_abc'
    const editor = docWithImages({ src: persistedSrc, alt: 'photo' })
    const renderedSrc = ws.resolveImageSrc(persistedSrc) as string
    const match = findHostedImageAttrs(editor.state.doc, [renderedSrc], ws.resolveImageSrc)
    expect(match).not.toBeNull()
    if (match) match.alt = 'mutated'
    let originalAlt: unknown
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'image') originalAlt = node.attrs.alt
    })
    expect(originalAlt).toBe('photo')
  })
})

describe('origin-aware src normalization (browser-native drag/copy enrichment uses ABSOLUTE urls)', () => {
  const ORIGIN = 'https://www.staging.sim.ai'

  it('toSameOriginPath: relative passes through; same-origin absolute → path+query; cross-origin → null', () => {
    expect(toSameOriginPath('/api/files/view/wf_a', ORIGIN)).toBe('/api/files/view/wf_a')
    expect(toSameOriginPath(`${ORIGIN}/api/workspaces/ws-1/files/inline?fileId=wf_a`, ORIGIN)).toBe(
      '/api/workspaces/ws-1/files/inline?fileId=wf_a'
    )
    expect(toSameOriginPath('https://evil.example.com/api/files/view/wf_a', ORIGIN)).toBeNull()
  })

  it('isInlineRouteSrc accepts the same-origin ABSOLUTE inline route (the real dragged-img src on staging)', () => {
    expect(isInlineRouteSrc(`${ORIGIN}/api/workspaces/ws-1/files/inline?fileId=wf_a`, ORIGIN)).toBe(
      true
    )
    expect(
      isInlineRouteSrc(
        'https://evil.example.com/api/workspaces/ws-1/files/inline?fileId=wf_a',
        ORIGIN
      )
    ).toBe(false)
  })

  it('hasHostedImageHtml matches absolute same-origin srcs and rejects cross-origin ones', () => {
    const isHosted = (src: string) => extractEmbeddedFileRef(src) !== null
    expect(hasHostedImageHtml(`<img src="${ORIGIN}/api/files/view/wf_a">`, isHosted, ORIGIN)).toBe(
      true
    )
    expect(
      hasHostedImageHtml(
        `<img src="${ORIGIN}/api/workspaces/ws-1/files/inline?fileId=wf_a">`,
        isHosted,
        ORIGIN
      )
    ).toBe(true)
    expect(
      hasHostedImageHtml(
        '<img src="https://evil.example.com/api/files/view/wf_a">',
        isHosted,
        ORIGIN
      )
    ).toBe(false)
  })

  it('findHostedImageAttrs matches when the clipboard html carries the absolute rendered url', () => {
    const ws = createWorkspaceFileContentSource('ws-1')
    const editor = new Editor({
      extensions: createMarkdownEditorExtensions({ placeholder: '' }),
      content: {
        type: 'doc',
        content: [{ type: 'image', attrs: { src: '/api/files/view/wf_abc', alt: 'photo' } }],
      },
    })
    const absolute = `${ORIGIN}/api/workspaces/ws-1/files/inline?fileId=wf_abc`
    const match = findHostedImageAttrs(editor.state.doc, [absolute], ws.resolveImageSrc, ORIGIN)
    expect(match?.src).toBe('/api/files/view/wf_abc')
  })
})

describe('htmlReferencesSrc (the "this drop is MY dragged image" check)', () => {
  const ORIGIN = 'https://www.staging.sim.ai'
  const RESOLVED = '/api/workspaces/ws-1/files/inline?fileId=wf_a'

  it('true when the html img src is the absolute form of the resolved src', () => {
    expect(htmlReferencesSrc(`<img src="${ORIGIN}${RESOLVED}">`, RESOLVED, ORIGIN)).toBe(true)
  })

  it('true for the relative form too (ProseMirror-serialized html)', () => {
    expect(htmlReferencesSrc(`<img src="${RESOLVED}">`, RESOLVED, ORIGIN)).toBe(true)
  })

  it('false for a different image, empty html, missing resolved src, or cross-origin', () => {
    expect(htmlReferencesSrc(`<img src="${ORIGIN}/api/other?fileId=wf_b">`, RESOLVED, ORIGIN)).toBe(
      false
    )
    expect(htmlReferencesSrc('', RESOLVED, ORIGIN)).toBe(false)
    expect(htmlReferencesSrc(`<img src="${ORIGIN}${RESOLVED}">`, undefined, ORIGIN)).toBe(false)
    expect(
      htmlReferencesSrc(`<img src="https://evil.example.com${RESOLVED}">`, RESOLVED, ORIGIN)
    ).toBe(false)
  })
})
