import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { SlashCommandList } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/rich-markdown-editor/slash-command-list'
import {
  filterSlashCommands,
  type SlashCommandItem,
  type SlashCommandStorage,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/rich-markdown-editor/slash-commands'
import { createSuggestionPopupRenderer } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/rich-markdown-editor/suggestion-popup'
import { SLASH_COMMAND_PLUGIN_KEY } from '@/platform/lib/data/files/markdown'

declare module '@tiptap/core' {
  interface Storage {
    slashCommand: SlashCommandStorage
  }
}

/**
 * The `/` block menu. Typing `/` at the start of a block, or after whitespace, opens the list;
 * choosing an item runs its block transform. Image appears only once the editor wires its upload.
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
        items: ({ editor, query }) =>
          filterSlashCommands(query, {
            allowImages: editor.storage.slashCommand.insertImage != null,
          }),
        command: ({ editor, range, props }) => props.run({ editor, range }),
        render: createSuggestionPopupRenderer({
          component: SlashCommandList,
          mapProps: (props) => ({
            items: props.items as SlashCommandItem[],
            command: props.command,
            editor: props.editor,
          }),
        }),
      }),
    ]
  },
})
