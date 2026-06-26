/**
 * @vitest-environment jsdom
 *
 * The leaf-selection arrow shortcuts (ArrowUp/ArrowDown → select an adjacent divider/image) run at a
 * high priority, so they must yield while a `/` or `@` suggestion menu is open — otherwise the arrow
 * selects the adjacent node instead of moving the menu selection. These assert the plugin state the
 * keymap's `isSuggestionMenuOpen` guard reads flips on when a menu opens.
 */
import { Editor } from '@tiptap/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownEditorExtensions } from './extensions'
import { MENTION_PLUGIN_KEY } from './mention'
import { SLASH_COMMAND_PLUGIN_KEY } from './slash-command/slash-command'

function editorWith(content: string): Editor {
  return new Editor({ extensions: createMarkdownEditorExtensions({ placeholder: '' }), content })
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
