import { describe, expect, it } from 'vitest'
import { appendNoteImageMarkdown } from '@/lib/workflows/notes/add-image'

const image = {
  url: 'https://sim.test/api/workspaces/ws-1/files/inline?fileId=f1',
  alt: 'shot.png',
}

describe('appendNoteImageMarkdown', () => {
  it('separates the image from existing content so it renders as its own block', () => {
    expect(appendNoteImageMarkdown('Some notes', image)).toBe(
      `Some notes\n\n![${image.alt}](${image.url})`
    )
  })

  it('does not accumulate blank lines across repeated appends', () => {
    const once = appendNoteImageMarkdown('Some notes\n\n\n', image)
    const twice = appendNoteImageMarkdown(once, image)
    expect(twice).toBe(
      `Some notes\n\n![${image.alt}](${image.url})\n\n![${image.alt}](${image.url})`
    )
  })
})
