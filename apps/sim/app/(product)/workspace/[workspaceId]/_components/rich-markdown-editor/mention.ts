import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { MentionList } from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/mention-list'
import { createSuggestionPopupRenderer } from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/suggestion-popup'
import {
  createMentionStore,
  MENTION_PLUGIN_KEY,
  type MentionItem,
  type MentionStorage,
} from '@/platform/lib/data/files/markdown'

declare module '@tiptap/core' {
  interface Storage {
    mentionMenu: MentionStorage
  }
}

/**
 * The `@` mention menu. Typing `@` at the start of a block or after whitespace (so an email stays
 * literal) opens the list; choosing an entity inserts it as a portable `sim:<kind>/<id>` link.
 */
export const Mention = Extension.create<Record<string, never>, MentionStorage>({
  name: 'mentionMenu',

  addStorage() {
    return {
      store: createMentionStore(),
      onOpen: null,
      onQuery: null,
      enabled: true,
      navigable: false,
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<MentionItem, MentionItem>({
        editor: this.editor,
        pluginKey: MENTION_PLUGIN_KEY,
        char: '@',
        allowSpaces: false,
        startOfLine: false,
        allow: ({ editor, range }) => {
          if (!editor.storage.mentionMenu.enabled) return false
          if (editor.isActive('codeBlock') || editor.isActive('link') || editor.isActive('code')) {
            return false
          }
          const $from = editor.state.doc.resolve(range.from)
          if ($from.parentOffset === 0) return true
          return /\s/.test($from.parent.textBetween($from.parentOffset - 1, $from.parentOffset))
        },
        items: ({ editor, query }) => {
          editor.storage.mentionMenu.onQuery?.(query)
          return []
        },
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              { type: 'mention', attrs: { kind: props.kind, id: props.id, label: props.label } },
              { type: 'text', text: ' ' },
            ])
            .run()
        },
        render: createSuggestionPopupRenderer({
          component: MentionList,
          mapProps: (props) => ({
            query: props.query,
            command: props.command,
            store: props.editor.storage.mentionMenu.store,
            editor: props.editor,
          }),
          onOpen: (props) => props.editor.storage.mentionMenu?.onOpen?.(),
        }),
      }),
    ]
  },
})
