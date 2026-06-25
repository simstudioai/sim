import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { createSuggestionPopupRenderer } from '../menus/suggestion-popup'
import { MentionList } from './mention-list'
import { createMentionStore, type MentionStore } from './mention-store'
import { toSimHref } from './sim-link'
import type { MentionItem } from './types'

/** Distinct from the `/` slash command's default `suggestion` key — two plugins can't share one key. */
const MENTION_PLUGIN_KEY = new PluginKey('mention')

/**
 * Per-editor storage for the `@` mention extension. The host component populates {@link store} with
 * the current workspace mention data and may set {@link onOpen} to lazily start fetching that data the
 * first time the menu is triggered. {@link enabled} gates the menu off entirely (e.g. a field with no
 * workspace scope) so `@` stays literal text.
 */
export interface MentionStorage {
  store: MentionStore
  onOpen: (() => void) | null
  enabled: boolean
}

declare module '@tiptap/core' {
  interface Storage {
    mention: MentionStorage
  }
}

/**
 * Adds the `@` mention menu to the editor. Typing `@` at the start of a block — or after whitespace —
 * opens {@link MentionList}; selecting an entity inserts it as a portable `sim:<kind>/<id>` markdown
 * link (same wire format as the chat composer's `chip-clipboard-codec`), so it round-trips natively
 * through the editor's link + markdown machinery. The menu's data is supplied by the host via the
 * extension's `mention` storage.
 */
export const Mention = Extension.create<Record<string, never>, MentionStorage>({
  name: 'mention',

  addStorage() {
    return { store: createMentionStore(), onOpen: null, enabled: true }
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
          // Only after whitespace, so `@` inside an email/handle (`name@host`) never triggers.
          return /\s/.test($from.parent.textBetween($from.parentOffset - 1, $from.parentOffset))
        },
        // Items are sourced reactively from the store inside MentionList; this only gates the plugin.
        items: () => [],
        command: ({ editor, range, props }) => {
          const href = toSimHref(props.kind, props.id)
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              { type: 'text', text: props.label, marks: [{ type: 'link', attrs: { href } }] },
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
          onOpen: (props) => props.editor.storage.mention.onOpen?.(),
        }),
      }),
    ]
  },
})
