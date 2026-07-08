/**
 * @vitest-environment jsdom
 *
 * The leaf-selection arrow shortcuts (ArrowUp/ArrowDown → select an adjacent divider/image) run at a
 * high priority, so they must yield while a `/` or `@` suggestion menu is open — otherwise the arrow
 * selects the adjacent node instead of moving the menu selection. These assert the plugin state the
 * keymap's `isSuggestionMenuOpen` guard reads flips on when a menu opens.
 */
import { Editor } from '@tiptap/core'
import { AllSelection, NodeSelection } from '@tiptap/pm/state'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownEditorExtensions } from './editor-extensions'
import { MENTION_PLUGIN_KEY } from './mention'
import { SLASH_COMMAND_PLUGIN_KEY } from './slash-command/slash-command'

function editorWith(content: string): Editor {
  return new Editor({ extensions: createMarkdownEditorExtensions({ placeholder: '' }), content })
}

/** Block-type sequence of the top-level doc nodes. */
function blockShape(editor: Editor): string[] {
  const shape: string[] = []
  editor.state.doc.forEach((node) => shape.push(node.type.name))
  return shape
}

/** Position of the first node of `type`, or -1. */
function firstPosOf(editor: Editor, type: string): number {
  let pos = -1
  editor.state.doc.descendants((node, p) => {
    if (pos < 0 && node.type.name === type) pos = p
  })
  return pos
}

function pressKey(editor: Editor, key: string): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  )
}

function pressBackspace(editor: Editor): void {
  pressKey(editor, 'Backspace')
}

/** Empties the item whose text is `word` (caret left at its start), the state before a boundary key. */
function emptyItem(editor: Editor, word: string): void {
  let from = -1
  let to = -1
  editor.state.doc.descendants((node, pos) => {
    if (from < 0 && node.isText && node.text === word) {
      from = pos
      to = pos + word.length
    }
  })
  editor.commands.setTextSelection({ from, to })
  editor.commands.deleteSelection()
}

/** Serialized markdown after re-parsing it once — equal to `getMarkdown()` only if it round-trips. */
function markdownRoundTrip(editor: Editor): { md: string; reparsed: string } {
  const md = editor.getMarkdown()
  editor.commands.setContent(md, { contentType: 'markdown' })
  return { md, reparsed: editor.getMarkdown() }
}

describe('suggestion-aware arrow keymap', () => {
  beforeEach(() => {
    // The suggestion render lifecycle uses these; jsdom lacks them.
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

  it('flags the mention menu active when `@` is typed before a divider', () => {
    const editor = editorWith('<p></p><hr>')
    editor.commands.focus()
    editor.commands.insertContent('@gma')

    expect(MENTION_PLUGIN_KEY.getState(editor.state)?.active).toBe(true)
    editor.destroy()
  })

  it('flags the slash menu active when `/` is typed', () => {
    const editor = editorWith('<p></p>')
    editor.commands.focus()
    editor.commands.insertContent('/')

    expect(SLASH_COMMAND_PLUGIN_KEY.getState(editor.state)?.active).toBe(true)
    editor.destroy()
  })

  it('keeps both menus inactive on plain text', () => {
    const editor = editorWith('<p>hello</p><hr>')
    editor.commands.focus()

    expect(MENTION_PLUGIN_KEY.getState(editor.state)?.active).toBe(false)
    expect(SLASH_COMMAND_PLUGIN_KEY.getState(editor.state)?.active).toBe(false)
    editor.destroy()
  })
})

describe('divider Backspace', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('removes the empty line between two dividers and selects the higher divider', () => {
    const editor = editorWith('<p>before</p><hr><p></p><hr><p>after</p>')
    editor.commands.focus()
    let emptyPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (emptyPos < 0 && node.type.name === 'paragraph' && node.content.size === 0)
        emptyPos = pos + 1
    })
    editor.commands.setTextSelection(emptyPos)
    pressBackspace(editor)

    expect(blockShape(editor)).toEqual([
      'paragraph',
      'horizontalRule',
      'horizontalRule',
      'paragraph',
    ])
    const { selection } = editor.state
    expect(selection instanceof NodeSelection).toBe(true)
    // The selected divider is the higher (first) one, not the lower.
    expect(selection.from).toBe(firstPosOf(editor, 'horizontalRule'))
    editor.destroy()
  })

  it('selects the divider when Backspace is pressed at the start of a non-empty block below it', () => {
    const editor = editorWith('<p>before</p><hr><p>text</p>')
    editor.commands.focus()
    let textStart = -1
    editor.state.doc.descendants((node, pos) => {
      if (textStart < 0 && node.type.name === 'paragraph' && node.textContent === 'text')
        textStart = pos + 1
    })
    editor.commands.setTextSelection(textStart)
    pressBackspace(editor)

    const { selection } = editor.state
    expect(selection instanceof NodeSelection).toBe(true)
    expect((selection as NodeSelection).node.type.name).toBe('horizontalRule')
    // The block is untouched — the divider is only highlighted, not deleted.
    expect(blockShape(editor)).toEqual(['paragraph', 'horizontalRule', 'paragraph'])
    editor.destroy()
  })

  it('select-all spans the whole document, dividers included', () => {
    const editor = editorWith('<p>a</p><hr><p>b</p><hr><p>c</p>')
    editor.commands.selectAll()

    const { selection, doc } = editor.state
    expect(selection instanceof AllSelection).toBe(true)
    expect(selection.from).toBe(0)
    expect(selection.to).toBe(doc.content.size)
    editor.destroy()
  })
})

describe('empty wrapped-block Backspace', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  it.each([
    ['bullet middle', '- one\n- two\n- three', 'two', '- one\n- three'],
    ['bullet first', '- one\n- two\n- three', 'one', '- two\n- three'],
    ['bullet last', '- one\n- two', 'two', '- one'],
    ['ordered middle', '1. one\n2. two\n3. three', 'two', '1. one\n2. three'],
    ['task middle', '- [ ] one\n- [ ] two\n- [ ] three', 'two', '- [ ] one\n- [ ] three'],
    ['blockquote middle', '> one\n>\n> two\n>\n> three', 'two', '> one\n>\n> three'],
    ['nested item', '- one\n  - two\n- three', 'two', '- one\n- three'],
  ])(
    'removes the emptied %s cleanly — one container, no stray paragraph, round-trips',
    (_label, markdown, word, expected) => {
      const editor = editorWith('')
      editor.commands.setContent(markdown, { contentType: 'markdown' })
      editor.commands.focus()
      emptyItem(editor, word)
      pressBackspace(editor)

      const { md, reparsed } = markdownRoundTrip(editor)
      expect(md.trim()).toBe(expected)
      expect(reparsed).toBe(md)
      editor.destroy()
    }
  )
})

describe('empty list-item Enter', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('removes an empty MIDDLE item instead of splitting the list into a stranded paragraph', () => {
    const editor = editorWith('')
    editor.commands.setContent('- one\n- two\n- three', { contentType: 'markdown' })
    editor.commands.focus()
    emptyItem(editor, 'two')
    pressKey(editor, 'Enter')

    const { md, reparsed } = markdownRoundTrip(editor)
    expect(md.trim()).toBe('- one\n- three')
    expect(reparsed).toBe(md)
    editor.destroy()
  })

  it('leaves an empty TRAILING item to the default (exits the list)', () => {
    const editor = editorWith('')
    editor.commands.setContent('- one\n- two', { contentType: 'markdown' })
    editor.commands.focus()
    emptyItem(editor, 'two')
    pressKey(editor, 'Enter')

    const list = editor.getJSON().content?.find((node) => node.type === 'bulletList')
    expect(list?.content).toHaveLength(1)
    expect(editor.getJSON().content?.some((node) => node.type === 'paragraph')).toBe(true)
    editor.destroy()
  })
})
