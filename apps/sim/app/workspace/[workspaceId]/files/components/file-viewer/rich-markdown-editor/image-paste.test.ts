/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { extractImageFiles, hasHostedImageHtml } from './image-paste'

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
})
