/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from './extensions'
import { findHeadingPos, slugifyHeading } from './heading-anchors'

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

/** A ProseMirror doc parsed from markdown, for the position-resolution tests. */
function docOf(markdown: string) {
  editor = new Editor({ extensions: createMarkdownContentExtensions() })
  editor.commands.setContent(markdown, { contentType: 'markdown' })
  return editor.state.doc
}

describe('slugifyHeading', () => {
  it('lowercases, drops punctuation, and hyphenates whitespace (GitHub-style)', () => {
    expect(slugifyHeading('Getting Started')).toBe('getting-started')
    expect(slugifyHeading('API Reference!')).toBe('api-reference')
    expect(slugifyHeading('  Spaced   Out  ')).toBe('spaced-out')
    expect(slugifyHeading('Node.js & Bun')).toBe('nodejs-bun')
  })

  it('returns an empty string for punctuation-only text', () => {
    expect(slugifyHeading('!!!')).toBe('')
    expect(slugifyHeading('')).toBe('')
  })
})

describe('findHeadingPos', () => {
  it('resolves a fragment slug to its heading position', () => {
    const doc = docOf('# Intro\n\ntext\n\n## Getting Started\n\nmore')
    expect(findHeadingPos(doc, 'intro')).toBeGreaterThanOrEqual(0)
    expect(findHeadingPos(doc, 'getting-started')).toBeGreaterThan(findHeadingPos(doc, 'intro'))
  })

  it('disambiguates duplicate slugs GitHub-style (foo, foo-1, foo-2)', () => {
    const doc = docOf('# Notes\n\na\n\n# Notes\n\nb\n\n# Notes\n\nc')
    const first = findHeadingPos(doc, 'notes')
    const second = findHeadingPos(doc, 'notes-1')
    const third = findHeadingPos(doc, 'notes-2')
    expect(first).toBeGreaterThanOrEqual(0)
    expect(second).toBeGreaterThan(first)
    expect(third).toBeGreaterThan(second)
  })

  it('returns -1 when no heading matches', () => {
    const doc = docOf('# Only Heading\n\nbody')
    expect(findHeadingPos(doc, 'missing')).toBe(-1)
  })
})
