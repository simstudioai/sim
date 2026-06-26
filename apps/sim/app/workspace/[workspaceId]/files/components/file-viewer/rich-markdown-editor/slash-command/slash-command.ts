import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { createSuggestionPopupRenderer } from '../menus/suggestion-popup'
import {
  filterSlashCommands,
  type SlashCommandContext,
  type SlashCommandItem,
  type SlashCommandStorage,
} from './commands'
import { SlashCommandList } from './slash-command-list'

declare module '@tiptap/core' {
  interface Storage {
    slashCommand: SlashCommandStorage
  }
}

/** Explicit key (distinct from the `@` mention's) so the keymap can detect an open menu. */
export const SLASH_COMMAND_PLUGIN_KEY = new PluginKey('slashCommand')

/**
 * Adds the `/` slash-command menu to the editor. Typing `/` at the start of a block — or after
 * whitespace — opens {@link SlashCommandList}; selecting an item runs its block transform.
 */
export const SlashCommand = Extension.create<Record<string, never>, SlashCommandStorage>({
  name: 'slashCommand',

  addStorage() {
    return { insertImage: null }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem, SlashCommandItem>({
        editor: this.editor,
        pluginKey: SLASH_COMMAND_PLUGIN_KEY,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        allow: ({ editor, range }) => {
          if (
            editor.isActive('codeBlock') ||
            editor.isActive('table') ||
            editor.isActive('link') ||
            editor.isActive('code')
          ) {
            return false
          }
          const $from = editor.state.doc.resolve(range.from)
          if ($from.parentOffset === 0) return true
          return /\s/.test($from.parent.textBetween($from.parentOffset - 1, $from.parentOffset))
        },
        // The Image command is offered only where image upload is wired (the file viewer); the modal
        // field editors never set `insertImage`, so `@`-style image insertion is hidden there.
        items: ({ editor, query }) =>
          filterSlashCommands(query, {
            allowImages: editor.storage.slashCommand.insertImage != null,
          }),
        command: ({ editor, range, props }) => {
          const ctx: SlashCommandContext = { editor, range }
          props.run(ctx)
        },
        render: createSuggestionPopupRenderer({
          component: SlashCommandList,
          mapProps: (props) => ({
            items: props.items as SlashCommandItem[],
            command: props.command,
          }),
        }),
      }),
    ]
  },
})
