import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { createSuggestionPopupRenderer } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/suggestion-popup'
import {
  filterSlashCommands,
  type SlashCommandContext,
  type SlashCommandItem,
  type SlashCommandStorage,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/slash-command/commands'
import { SlashCommandList } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/slash-command/slash-command-list'
import { SLASH_COMMAND_PLUGIN_KEY } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/suggestion-plugin-keys'

declare module '@tiptap/core' {
  interface Storage {
    slashCommand: SlashCommandStorage
  }
}

/**
 * Adds the `/` slash-command menu to the editor. Typing `/` at the start of a block — or after
 * whitespace — opens {@link SlashCommandList}; selecting an item runs its block transform. The Image
 * command appears only where image upload is wired (the file viewer); modal field editors never set
 * `insertImage`, so it stays hidden there.
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
        command: ({ editor, range, props }) => {
          const ctx: SlashCommandContext = { editor, range }
          props.run(ctx)
        },
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
