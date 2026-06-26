import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { createSuggestionPopupRenderer } from '../menus/suggestion-popup'
import { MentionList } from './mention-list'
import { createMentionStore, type MentionStore } from './mention-store'
import type { MentionItem } from './types'

/** Distinct from the `/` slash command's key — two plugins can't share one key. Exported so the keymap can detect an open menu. */
export const MENTION_PLUGIN_KEY = new PluginKey('mention')

/**
 * Per-editor storage for the `@` mention extension. The host component populates {@link store} with
 * the current workspace mention data and may set {@link onOpen} to lazily start fetching that data the
 * first time the menu is triggered. {@link enabled} gates the menu off entirely (e.g. a field with no
 * workspace scope) so `@` stays literal text. {@link navigable} lets a chip Cmd/Ctrl-click to its
 * resource — on for the file viewer, off inside a modal field so it can't route away from an edit.
 */
export interface MentionStorage {
  store: MentionStore
  onOpen: (() => void) | null
  enabled: boolean
  navigable: boolean
}

declare module '@tiptap/core' {
  interface Storage {
    mention: MentionStorage
  }
}

/**
 * Adds the `@` mention menu to the editor. Typing `@` at the start of a block — or after whitespace, so
 * `@` inside an email/handle (`name@host`) stays literal — opens {@link MentionList}; selecting an
 * entity inserts it as a portable `sim:<kind>/<id>` markdown link (same wire format as the chat
 * composer's `chip-clipboard-codec`), so it round-trips natively through the editor's link + markdown
 * machinery. The plugin's `items` is an empty gate; the real list is sourced reactively from the store
 * inside {@link MentionList}, populated by the host via the extension's `mention` storage.
 */
export const Mention = Extension.create<Record<string, never>, MentionStorage>({
  name: 'mention',

  addStorage() {
    return { store: createMentionStore(), onOpen: null, enabled: true, navigable: false }
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
          if (!editor.storage.mention.enabled) return false
          if (editor.isActive('codeBlock') || editor.isActive('link') || editor.isActive('code')) {
            return false
          }
          const $from = editor.state.doc.resolve(range.from)
          if ($from.parentOffset === 0) return true
          return /\s/.test($from.parent.textBetween($from.parentOffset - 1, $from.parentOffset))
        },
        items: () => [],
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
            store: props.editor.storage.mention.store,
          }),
          onOpen: (props) => props.editor.storage.mention?.onOpen?.(),
        }),
      }),
    ]
  },
})
