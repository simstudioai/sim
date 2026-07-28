/**
 * @vitest-environment jsdom
 *
 * The leaf-selection arrow shortcuts (ArrowUp/ArrowDown → select an adjacent divider/image) run at a
 * high priority, so they must yield while a `/` or `@` suggestion menu is open — otherwise the arrow
 * selects the adjacent node instead of moving the menu selection. These assert the plugin state the
 * keymap's `isSuggestionMenuOpen` guard reads flips on when a menu opens.
 */
import { Editor } from '@tiptap/core'
import { GapCursor } from '@tiptap/pm/gapcursor'
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

  it('only paints a divider inside a range selection while the editor has focus', () => {
    const editor = editorWith('<p>a</p><hr><p>b</p>')
    const divider = editor.view.dom.querySelector('hr')
    editor.commands.selectAll()

    expect(divider?.classList.contains('rich-leaf-in-selection')).toBe(false)

    editor.view.dom.dispatchEvent(new FocusEvent('focus'))
    expect(divider?.classList.contains('rich-leaf-in-selection')).toBe(true)

    editor.view.dom.dispatchEvent(new FocusEvent('blur'))
    expect(editor.state.selection.empty).toBe(false)
    expect(divider?.classList.contains('rich-leaf-in-selection')).toBe(false)
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

  it('leaves a gap cursor — never a NodeSelection — when the removed bullet was followed by an image at doc start', () => {
    // Regression: `Selection.near` after the delete silently NodeSelected the following image, so a
    // second Backspace while "clearing the bullet" deleted the image (and typing would have replaced
    // it). The selection left behind must never make the next keystroke destructive.
    const editor = editorWith({
      type: 'doc',
      content: [
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
        { type: 'image', attrs: { src: '/api/files/view/wf_img', alt: 'photo' } },
      ],
    })
    editor.commands.setTextSelection(3)
    pressBackspace(editor)

    expect(blockShape(editor)).toEqual(['image', 'paragraph'])
    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection)

    pressBackspace(editor)
    expect(blockShape(editor)).toEqual(['image', 'paragraph'])
    editor.destroy()
  })

  it('does not crash on Backspace from a gap cursor (top-level selection, depth 0)', () => {
    // Regression: `$from.before($from.depth)` with a gap cursor's depth of 0 threw
    // "RangeError: There is no position before the top-level node" — reachable whenever a gap
    // cursor sits between two leaves (the `data-gap-between-leaves` state) and Backspace is pressed.
    const editor = editorWith('<hr><hr>')
    const gapPos = editor.state.doc.firstChild ? editor.state.doc.firstChild.nodeSize : 1
    editor.view.dispatch(
      editor.state.tr.setSelection(new GapCursor(editor.state.doc.resolve(gapPos)))
    )
    expect(editor.state.selection).toBeInstanceOf(GapCursor)

    expect(() => pressBackspace(editor)).not.toThrow()
    // TipTap appends a trailing paragraph after the final leaf; the dividers must both survive.
    expect(blockShape(editor)).toEqual(['horizontalRule', 'horizontalRule', 'paragraph'])
    editor.destroy()
  })

  it('never NodeSelects a leaf BEFORE the removed bullet either (findFrom textOnly skips atoms)', () => {
    // `Selection.findFrom($gap, -1, true)` cannot return a NodeSelection: with textOnly,
    // prosemirror-state's findSelectionIn skips atoms entirely (`!text && isSelectable`). With an
    // image directly before the emptied bullet and no textblock behind it, the backward search
    // returns null and the gap-cursor branch takes over — the image is never silently selected.
    const editor = editorWith({
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: '/api/files/view/wf_img', alt: 'photo' } },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
      ],
    })
    editor.commands.setTextSelection(4)
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
    pressBackspace(editor)

    expect(blockShape(editor)).toEqual(['image', 'paragraph'])
    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection)

    pressBackspace(editor)
    expect(blockShape(editor)).toEqual(['image', 'paragraph'])
    editor.destroy()
  })

  it('does not crash on Backspace from a gap cursor at the very start of the doc', () => {
    // Depth-0 + offset-0 is the worst case: our old code threw before(0), and TipTap's blockquote
    // handler crashes on $from.node(-1) if the key falls through — so it must be consumed.
    const editor = editorWith({
      type: 'doc',
      content: [{ type: 'image', attrs: { src: '/api/files/view/wf_img', alt: 'photo' } }],
    })
    editor.view.dispatch(editor.state.tr.setSelection(new GapCursor(editor.state.doc.resolve(0))))
    expect(editor.state.selection).toBeInstanceOf(GapCursor)

    expect(() => pressBackspace(editor)).not.toThrow()
    expect(blockShape(editor)).toEqual(['image', 'paragraph'])
    editor.destroy()
  })

  it('still prefers the previous textblock caret when one exists (image after the bullet untouched)', () => {
    const editor = editorWith({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
        { type: 'image', attrs: { src: '/api/files/view/wf_img', alt: 'photo' } },
      ],
    })
    editor.commands.setTextSelection(10)
    pressBackspace(editor)

    expect(blockShape(editor)).toEqual(['paragraph', 'image', 'paragraph'])
    expect(editor.state.selection.empty).toBe(true)
    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection)
    expect(editor.state.selection.$from.parent.textContent).toBe('hello')
    editor.destroy()
  })
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

describe('verbatim block boundary (isolating)', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  function caretIntoNode(editor: Editor, nodeType: string): void {
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === nodeType) editor.commands.setTextSelection(pos + 1)
    })
  }

  it.each([
    ['footnote definition', 'body text[^x]\n\n[^x]: the note', 'footnoteDef'],
    ['raw HTML block', 'body\n\n<div>\nhello\n</div>', 'rawHtmlBlock'],
  ])(
    'Backspace at the start of a %s does not merge across its boundary and destroy it',
    (_label, markdown, nodeType) => {
      const editor = editorWith('')
      editor.commands.setContent(markdown, { contentType: 'markdown' })
      editor.commands.focus()
      expect(blockShape(editor)).toContain(nodeType)
      caretIntoNode(editor, nodeType)
      pressBackspace(editor)
      expect(blockShape(editor)).toContain(nodeType)
      editor.destroy()
    }
  )
})

describe('block reordering (Mod-Shift-Arrow)', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  function caretInto(editor: Editor, word: string): void {
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text?.includes(word)) editor.commands.setTextSelection(pos + 1)
    })
  }

  it('moves the current top-level block up, carrying the caret', () => {
    const editor = editorWith('')
    editor.commands.setContent('# One\n\nTwo para\n\n- item', { contentType: 'markdown' })
    editor.commands.focus()
    caretInto(editor, 'Two')
    editor.commands.moveBlockUp()
    expect(editor.getMarkdown().trim().startsWith('Two para')).toBe(true)
    editor.destroy()
  })

  it('moves the current top-level block down', () => {
    const editor = editorWith('')
    editor.commands.setContent('# One\n\nTwo para', { contentType: 'markdown' })
    editor.commands.focus()
    caretInto(editor, 'One')
    editor.commands.moveBlockDown()
    expect(editor.getMarkdown().trim().startsWith('Two para')).toBe(true)
    editor.destroy()
  })

  it.each([
    ['up', '# One\n\nabcdef'],
    ['down', 'abcdef\n\n# Two'],
  ])('keeps the caret at its original offset after moving %s (no off-by-one)', (direction, md) => {
    const editor = editorWith('')
    editor.commands.setContent(md, { contentType: 'markdown' })
    editor.commands.focus()
    let textPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'abcdef') textPos = pos
    })
    editor.commands.setTextSelection(textPos + 3)
    if (direction === 'up') editor.commands.moveBlockUp()
    else editor.commands.moveBlockDown()
    const at = editor.state.selection.from
    expect(editor.state.doc.textBetween(at - 1, at)).toBe('c')
    expect(editor.state.doc.textBetween(at, at + 1)).toBe('d')
    editor.destroy()
  })

  it('is a no-op at the top edge and keeps a moved list intact', () => {
    const top = editorWith('')
    top.commands.setContent('# One\n\nTwo', { contentType: 'markdown' })
    top.commands.focus()
    caretInto(top, 'One')
    top.commands.moveBlockUp()
    expect(top.getMarkdown().trim().startsWith('# One')).toBe(true)
    top.destroy()

    const list = editorWith('')
    list.commands.setContent('- a\n- b\n\npara', { contentType: 'markdown' })
    list.commands.focus()
    caretInto(list, 'para')
    list.commands.moveBlockUp()
    expect(list.getMarkdown().trim()).toBe('para\n\n- a\n- b')
    list.destroy()
  })
})
