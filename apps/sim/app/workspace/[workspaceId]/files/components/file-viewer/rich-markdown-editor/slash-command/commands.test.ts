/**
 * @vitest-environment jsdom
 */
import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { createMarkdownEditorExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/editor-extensions'
import { SLASH_COMMANDS } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/slash-command/commands'

const chart = SLASH_COMMANDS.find((command) => command.title === 'Chart')

describe('Chart slash command', () => {
  it.each([
    ['an empty paragraph', '<p>/chart</p>'],
    ['the end of existing text', '<p>Intro /chart</p>'],
  ])('puts the caret at the start of the starter fence from %s', (_, content) => {
    const editor = new Editor({
      extensions: createMarkdownEditorExtensions({ placeholder: '' }),
      content,
    })
    const end = editor.state.doc.content.size - 1
    const from = editor.state.doc.textBetween(0, end).indexOf('/') + 1
    chart?.run({ editor, range: { from, to: end } })
    const { $from } = editor.state.selection
    expect($from.parent.type.name).toBe('codeBlock')
    expect($from.parent.attrs.language).toBe('dashboard')
    expect($from.parentOffset).toBe(0)
    editor.destroy()
  })
})
