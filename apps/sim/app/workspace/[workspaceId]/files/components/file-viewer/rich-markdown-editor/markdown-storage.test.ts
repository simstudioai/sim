/**
 * @vitest-environment jsdom
 */
import { Editor, type JSONContent } from '@tiptap/core'
import { CellSelection } from '@tiptap/pm/tables'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import { RichMarkdownKeymap } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/keymap'
import { postProcessSerializedMarkdown } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import { editorNormalForm } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'
import { isRoundTripSafe } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/round-trip-safety'

const editors: Editor[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

function mount(content: string | JSONContent): Editor {
  const editor = new Editor({
    extensions: [...createMarkdownContentExtensions(), RichMarkdownKeymap],
    enablePasteRules: false,
    content: typeof content === 'string' ? editorNormalForm(content) : content,
  })
  editors.push(editor)
  return editor
}

function press(editor: Editor, key: string, options: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
  editor.view.dom.dispatchEvent(event)
  return event.defaultPrevented
}

function pasteHtml(editor: Editor, html: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/html' ? html : '') },
  })
  editor.view.dom.dispatchEvent(event)
}

function selectText(editor: Editor, text: string, offset = 0): void {
  let position = -1
  editor.state.doc.descendants((node, pos) => {
    const index = node.isText ? (node.text?.indexOf(text) ?? -1) : -1
    if (position < 0 && index >= 0) position = pos + index + offset
  })
  expect(position).toBeGreaterThan(-1)
  editor.commands.setTextSelection(position)
}

function expectPreserved(editor: Editor): string {
  const before = editor.getJSON()
  const markdown = postProcessSerializedMarkdown(editor.getMarkdown())
  const reopened = mount(markdown)
  expect(reopened.getJSON()).toEqual(before)
  expect(postProcessSerializedMarkdown(reopened.getMarkdown())).toBe(markdown)
  expect(isRoundTripSafe(markdown)).toBe(true)
  return markdown
}

describe('structural paragraphs survive storage', () => {
  it.each([
    ['plain document', '- one\n- two\n- three\n\nfollowing'],
    ['HTML elsewhere', '<!-- comment -->\n\n- one\n- two\n- three\n\nfollowing'],
    ['footnote elsewhere', 'note[^a]\n\n- one\n- two\n- three\n\nfollowing\n\n[^a]: note'],
    ['blockquote', '> - one\n> - two\n> - three\n>\n> following'],
    ['nested blockquote', '> > - one\n> > - two\n> > - three\n> >\n> > following'],
  ])('keeps a trailing list-exit paragraph in %s', (_label, markdown) => {
    const editor = mount(markdown)
    selectText(editor, 'three')
    editor.commands.deleteRange({
      from: editor.state.selection.from,
      to: editor.state.selection.from + 5,
    })
    expect(press(editor, 'Enter')).toBe(true)
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(expectPreserved(editor)).toContain('<p></p>')
  })

  it('treats an actual empty HTML paragraph as a paragraph without claiming other raw HTML', () => {
    const editor = mount('before\n\n<p></p>\n\n<div>raw</div>\n\nafter')
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      'paragraph',
      'paragraph',
      'rawHtmlBlock',
      'paragraph',
    ])
    expect(editor.getText()).toContain('<div>raw</div>')
  })

  it('does not store the trailing typing placeholder after a list as HTML', () => {
    const editor = mount('- one')
    expect(editor.getMarkdown()).not.toContain('<p></p>')
  })
})

describe('paragraph hard-break fidelity', () => {
  it.each(['# heading', '###### heading', '- item', '+ item', '1. item', '1) item', '---', '==='])(
    'preserves literal %s typed after Shift+Enter',
    (literal) => {
      const editor = mount('first')
      selectText(editor, 'first', 5)
      expect(press(editor, 'Enter', { shiftKey: true })).toBe(true)
      editor.commands.insertContent({ type: 'text', text: literal })
      expectPreserved(editor)
    }
  )

  it('preserves marked text and inline-code literals across hard breaks', () => {
    const editor = mount('first')
    selectText(editor, 'first', 5)
    press(editor, 'Enter', { shiftKey: true })
    editor.commands.insertContent([
      { type: 'text', text: '# heading', marks: [{ type: 'code' }] },
      { type: 'hardBreak' },
      { type: 'text', text: '- item', marks: [{ type: 'bold' }] },
    ])
    expectPreserved(editor)
  })

  it('preserves consecutive hard breaks instead of reparsing them as separate paragraphs', () => {
    const editor = mount('first')
    selectText(editor, 'first', 5)
    press(editor, 'Enter', { shiftKey: true })
    press(editor, 'Enter', { shiftKey: true })
    editor.commands.insertContent('next')
    expectPreserved(editor)
  })
})

describe('GFM table capabilities', () => {
  const markdown = '| heading | value |\n| --- | --- |\n| one | two |'

  it.each([false, true])('cell Enter with shift=%s creates a persistent hard break', (shiftKey) => {
    const editor = mount(markdown)
    selectText(editor, 'one', 3)
    expect(press(editor, 'Enter', { shiftKey })).toBe(true)
    editor.commands.insertContent('next')
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(expectPreserved(editor)).toContain('one<br>next')
  })

  it('does not let a heading shortcut or command create a nonpersistent block in a cell', () => {
    const editor = mount(markdown)
    selectText(editor, 'one')
    press(editor, '1', { ctrlKey: true, altKey: true })
    expect(editor.commands.toggleHeading({ level: 1 })).toBe(false)
    expect(editor.commands.toggleBulletList()).toBe(false)
    expect(editor.commands.toggleOrderedList()).toBe(false)
    expect(editor.commands.toggleTaskList()).toBe(false)
    expect(editor.commands.toggleBlockquote()).toBe(false)
    expect(editor.commands.setCodeBlock()).toBe(false)
    expect(editor.commands.setHorizontalRule()).toBe(false)
    expect(editor.commands.insertTable()).toBe(false)
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
    expectPreserved(editor)
  })

  it.each(['#', '-', '+', '*', '1.', '>', '```', '- [ ]'])(
    'leaves a typed %s block prefix as literal text in a cell',
    (prefix) => {
      const editor = mount(markdown)
      selectText(editor, 'one')
      editor.commands.deleteRange({
        from: editor.state.selection.from,
        to: editor.state.selection.from + 3,
      })
      editor.commands.insertContent({ type: 'text', text: prefix })
      const { from, to } = editor.state.selection
      const handled = editor.view.someProp('handleTextInput', (handler) =>
        handler(editor.view, from, to, ' ', () => editor.state.tr)
      )
      expect(handled).not.toBe(true)
      editor.commands.insertContent({ type: 'text', text: ' literal' })
      expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
      expectPreserved(editor)
    }
  )

  it('gates structural header removal, merged cells, and persistent-width commands', () => {
    const editor = mount(markdown)
    selectText(editor, 'heading')
    expect(editor.can().addRowBefore()).toBe(false)
    expect(editor.can().deleteRow()).toBe(false)
    expect(editor.commands.toggleHeaderRow()).toBe(false)
    expect(editor.commands.toggleHeaderColumn()).toBe(false)
    expect(editor.commands.toggleHeaderCell()).toBe(false)
    expect(editor.commands.mergeCells()).toBe(false)
    expect(editor.commands.setCellAttribute('colwidth', [240])).toBe(false)
    expectPreserved(editor)
  })

  it('preserves ordinary row and column editing through save and reopen', () => {
    const editor = mount(markdown)
    selectText(editor, 'one')
    expect(editor.commands.addRowBefore()).toBe(true)
    expect(editor.commands.addRowAfter()).toBe(true)
    expect(editor.commands.addColumnAfter()).toBe(true)
    expectPreserved(editor)
    selectText(editor, 'one')
    expect(editor.commands.deleteRow()).toBe(true)
    expectPreserved(editor)
  })

  it('new rows inherit column alignment so it stays identical after reload', () => {
    const editor = mount('| heading | value |\n| :---: | ---: |\n| one | two |')
    selectText(editor, 'one')
    expect(editor.commands.addRowBefore()).toBe(true)
    expect(editor.commands.addRowAfter()).toBe(true)
    expectPreserved(editor)
  })

  it('retains legacy rich cell nodes in the collaborative schema', () => {
    const editor = mount(markdown)
    const content = editor.getJSON()
    const cell = content.content?.[0].content?.[1].content?.[0]
    expect(cell).toBeDefined()
    if (!cell) return
    cell.content = [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'legacy heading' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'legacy paragraph' }] },
    ]
    editor.commands.setContent(content)
    expect(editor.getJSON()).toEqual(content)
    const saved = editor.getMarkdown()
    expect(saved).toContain('<h2>legacy heading</h2>')
    expect(saved).toContain('<p>legacy paragraph</p>')
    const reopened = mount(saved)
    expect(reopened.getJSON().content?.[0].type).toBe('rawHtmlBlock')
    expect(postProcessSerializedMarkdown(reopened.getMarkdown())).toBe(
      postProcessSerializedMarkdown(saved)
    )
  })

  it('preserves significant interior code whitespace in GFM cells', () => {
    const editor = mount('| heading |\n| --- |\n| `one  two` |')
    expect(expectPreserved(editor)).toContain('`one  two`')
    expect(editor.getMarkdown()).not.toContain('<table')
  })

  it('normalizes pasted table headings and paragraphs while preserving inline marks and blank lines', () => {
    const editor = mount('')
    pasteHtml(
      editor,
      '<table><tr><th>heading</th></tr><tr><td><h2><strong>bold</strong></h2><p></p><p><em>italic</em> <code>one two</code></p></td></tr></table>'
    )
    const cell = editor.getJSON().content?.[0].content?.[1].content?.[0]
    expect(cell?.content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', marks: [{ type: 'bold' }], text: 'bold' },
          { type: 'hardBreak' },
          { type: 'hardBreak' },
          { type: 'text', marks: [{ type: 'italic' }], text: 'italic' },
          { type: 'text', text: ' ' },
          { type: 'text', marks: [{ type: 'code' }], text: 'one two' },
        ],
      },
    ])
    expect(expectPreserved(editor)).not.toContain('<table')
  })

  it('pastes rich text blocks into an existing cell as inline content without changing surrounding text', () => {
    const editor = mount(markdown)
    selectText(editor, 'one', 1)
    pasteHtml(editor, '<h2><strong>bold</strong></h2><p><em>italic</em></p>')
    const cell = editor.getJSON().content?.[0].content?.[1].content?.[0]
    expect(cell?.content).toHaveLength(1)
    expect(cell?.content?.[0].type).toBe('paragraph')
    expect(editor.state.selection.$from.parent.textContent).toBe('obolditalicne')
    const saved = expectPreserved(editor)
    expect(saved).toContain('o**bold**<br>*italic*ne')
    expect(saved).not.toContain('<table')
  })

  it('leaves rich text blocks outside a table unchanged', () => {
    const editor = mount('')
    pasteHtml(editor, '<h2>heading</h2><p>paragraph</p>')
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(['heading', 'paragraph'])
    expectPreserved(editor)
  })

  it('normalizes native copied cells without rewriting the source document', () => {
    const source = mount(markdown)
    const sourceContent = source.getJSON()
    const sourceCell = sourceContent.content?.[0].content?.[1].content?.[0]
    expect(sourceCell).toBeDefined()
    if (!sourceCell) return
    sourceCell.content = [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'heading' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'paragraph' }] },
    ]
    source.commands.setContent(sourceContent)
    selectText(source, 'paragraph')
    const sourceCellPosition = source.state.selection.$from.before(3)
    source.view.dispatch(
      source.state.tr.setSelection(CellSelection.create(source.state.doc, sourceCellPosition))
    )
    const clipboard = source.view.serializeForClipboard(source.state.selection.content())
    const target = mount(markdown)
    selectText(target, 'one')
    pasteHtml(target, clipboard.dom.innerHTML)
    expect(source.getJSON()).toEqual(sourceContent)
    expect(expectPreserved(target)).toContain('heading<br>paragraph')
  })

  it.each([
    ['nested table', '<table><tr><td>nested</td></tr></table>', '<table'],
    ['image', '<img src="https://example.com/image.png" alt="image">', '<img'],
    ['list', '<ul><li><p>nested item</p></li></ul>', '<ul'],
  ])(
    'preserves an unsupported pasted %s through the lossless HTML fallback',
    (_label, block, tag) => {
      const editor = mount('')
      pasteHtml(
        editor,
        `<table><tr><th>heading</th></tr><tr><td><h2>keep heading</h2>${block}<p>keep paragraph</p></td></tr></table>`
      )
      const cell = editor.getJSON().content?.[0].content?.[1].content?.[0]
      expect(cell?.content?.[0].type).toBe('heading')
      const saved = postProcessSerializedMarkdown(editor.getMarkdown())
      expect(saved).toContain('<h2>keep heading</h2>')
      expect(saved).toContain('<p>keep paragraph</p>')
      expect(saved).toContain(tag)
      const reopened = mount(saved)
      expect(reopened.getJSON().content?.[0].type).toBe('rawHtmlBlock')
      expect(postProcessSerializedMarkdown(reopened.getMarkdown())).toBe(saved)
    }
  )
})
