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
import { createMarkdownEditorExtensions } from './extensions'
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

function pressBackspace(editor: Editor): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
  )
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
