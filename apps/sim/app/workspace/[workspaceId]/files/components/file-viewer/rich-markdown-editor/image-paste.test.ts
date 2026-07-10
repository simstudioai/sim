/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { extractEmbeddedFileRef } from '@/lib/uploads/utils/embedded-image-ref'
import {
  createPublicFileContentSource,
  createWorkspaceFileContentSource,
} from '@/hooks/use-file-content-source'
import {
  extractImageFiles,
  hasHostedImageHtml,
  isInlineRouteSrc,
  shouldSkipDropUpload,
  shouldSkipPasteUpload,
} from './image-paste'

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

describe('shouldSkipPasteUpload', () => {
  const isHosted = (src: string) => src.startsWith('/api/files/view/')
  const hostedHtml = '<img src="/api/files/view/wf_abc">'

  it('skips upload for a single already-hosted image', () => {
    expect(shouldSkipPasteUpload([imageFile()], hostedHtml, isHosted)).toBe(true)
  })

  it('does not skip when there is no html, or the html is not one of ours', () => {
    expect(shouldSkipPasteUpload([imageFile()], '', isHosted)).toBe(false)
    expect(shouldSkipPasteUpload([imageFile()], '<img src="https://x.com/a.png">', isHosted)).toBe(
      false
    )
  })

  it('does not skip when there are no files to upload in the first place', () => {
    expect(shouldSkipPasteUpload([], hostedHtml, isHosted)).toBe(false)
  })

  // Regression: a genuinely mixed paste (the hosted image plus a separate new one) must still
  // upload the new file — bailing out entirely here would silently drop it.
  it('does not skip a mixed paste carrying more than one image file', () => {
    expect(
      shouldSkipPasteUpload([imageFile('a.png'), imageFile('b.png')], hostedHtml, isHosted)
    ).toBe(false)
  })
})

describe('shouldSkipDropUpload', () => {
  it('skips upload for an internal image-node drag (dragging + an image file present)', () => {
    expect(shouldSkipDropUpload({ slice: {}, move: true }, [imageFile()])).toBe(true)
  })

  it('does not skip when dragging is null (a genuine external drop)', () => {
    expect(shouldSkipDropUpload(null, [imageFile()])).toBe(false)
  })

  // Regression: `view.dragging` can go briefly stale after a prior internal drag was dropped
  // outside the view (ProseMirror clears it up to ~50ms late via `dragend`). It must never suppress
  // handling of an unrelated drop that carries no image files (e.g. a PDF) in that window.
  it('does not skip a stale dragging state when the drop carries no image files', () => {
    expect(shouldSkipDropUpload({ slice: {}, move: true }, [])).toBe(false)
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
