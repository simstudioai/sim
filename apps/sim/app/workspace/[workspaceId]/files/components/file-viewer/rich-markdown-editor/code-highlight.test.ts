/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { buildDecorations } from './code-highlight'
import { createMarkdownContentExtensions } from './extensions'

let editor: Editor | null = null

function decorationClassesFor(markdown: string): string[] {
  editor = new Editor({ extensions: createMarkdownContentExtensions() })
  editor.commands.setContent(markdown, { contentType: 'markdown' })
  const decorations = buildDecorations(editor.state.doc).find()
  editor.destroy()
  editor = null
  return decorations.map(
    (decoration) =>
      (decoration as unknown as { type: { attrs: { class: string } } }).type.attrs.class
  )
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('code block syntax highlighting', () => {
  it('emits Prism token decorations for a known language', () => {
    const classes = decorationClassesFor('```js\nconst x = 1\n```')
    expect(classes.length).toBeGreaterThan(0)
    expect(classes.every((c) => c.startsWith('token'))).toBe(true)
    expect(classes.some((c) => c.includes('keyword'))).toBe(true)
  })

  it('does not decorate plain prose', () => {
    expect(decorationClassesFor('just some text')).toHaveLength(0)
  })

  it('does not decorate an unregistered language', () => {
    expect(decorationClassesFor('```unregistered-lang\n+++ foo\n```')).toHaveLength(0)
  })
})
