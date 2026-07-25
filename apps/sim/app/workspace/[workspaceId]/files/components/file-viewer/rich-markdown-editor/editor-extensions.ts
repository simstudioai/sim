import type { Extensions } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import Placeholder from '@tiptap/extension-placeholder'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { withAlpha } from '@/lib/workspaces/colors'
import { BlockMover } from './block-mover'
import { CodeBlockWithLanguage } from './code-block'
import { CodeBlockHighlight } from './code-highlight'
import { LinkEmbed } from './embed/link-embed'
import { createMarkdownContentExtensions } from './extensions'
import { ResizableImage } from './image'
import { RichMarkdownKeymap } from './keymap'
import { MarkdownPaste } from './markdown-paste'
import { Mention } from './mention/mention'
import { MentionChip } from './mention/mention-chip'
import { FootnoteDefWithView, RawHtmlBlockWithView } from './raw-markdown-snippet'
import { SlashCommand } from './slash-command/slash-command'

/** Live collaboration binding for the editor. When present, the editor's history
 * is Yjs-backed and remote carets/selection render via CollaborationCaret. */
export interface EditorCollaboration {
  doc: Y.Doc
  awareness: Awareness
  user: { name: string; color: string }
}

interface MarkdownEditorExtensionOptions {
  placeholder: string
  /** Renders supported media links as live players beneath a standalone link. Off by default. */
  embeds?: boolean
  /** When set, wires TipTap Collaboration + CollaborationCaret onto the shared document. */
  collaboration?: EditorCollaboration
}

/**
 * The full extension set for the live editor: the content extensions with their React node-view nodes
 * injected (code-block language picker, resizable image, mention chip) plus the UI-only extensions —
 * `CodeBlockHighlight` (Prism), `SlashCommand` (the `/` block menu), `Mention` (the `@` menu),
 * `RichMarkdownKeymap`, `MarkdownPaste`, `Placeholder`, and — when `embeds` is set — `LinkEmbed`
 * (media players for standalone links).
 *
 * Kept separate from `extensions.ts` so those node views (and the block registry the mention chip pulls
 * in for brand icons) stay out of the headless round-trip path, which only needs the schema.
 */
export function createMarkdownEditorExtensions({
  placeholder,
  embeds = false,
  collaboration,
}: MarkdownEditorExtensionOptions): Extensions {
  return [
    ...createMarkdownContentExtensions(
      {
        codeBlock: CodeBlockWithLanguage,
        image: ResizableImage,
        mention: MentionChip,
        rawHtmlBlock: RawHtmlBlockWithView,
        footnoteDef: FootnoteDefWithView,
      },
      { disableHistory: Boolean(collaboration) }
    ),
    ...(collaboration
      ? [
          Collaboration.configure({ document: collaboration.doc }),
          // CollaborationCaret reads only `provider.awareness`; the awareness is
          // created synchronously and relayed by the socket provider once connected.
          // The default caret + name label already color from `user.color`; only the
          // selection is overridden to a lighter translucent tint of the same color.
          CollaborationCaret.configure({
            provider: { awareness: collaboration.awareness },
            user: collaboration.user,
            selectionRender: (user) => {
              const hex = typeof user.color === 'string' ? user.color : '#000000'
              return {
                class: 'collaboration-carets__selection',
                style: `background-color: ${withAlpha(hex, 0.2)};`,
              }
            },
          }),
        ]
      : []),
    CodeBlockHighlight,
    SlashCommand,
    Mention,
    RichMarkdownKeymap,
    BlockMover,
    MarkdownPaste,
    Placeholder.configure({ placeholder }),
    ...(embeds ? [LinkEmbed] : []),
  ]
}
