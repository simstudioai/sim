/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { extractImageFiles } from './image-paste'

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
