import type { Extensions } from '@tiptap/core'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import Placeholder from '@tiptap/extension-placeholder'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { withAlpha } from '@/lib/workspaces/colors'
import { BlockMover } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/block-mover'
import { CodeBlockWithLanguage } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/code-block'
import { CodeBlockHighlight } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/code-highlight'
import {
  createCaretActivityExtension,
  DEFAULT_CARET_COLOR,
  renderCaret,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/caret-presence'
import { FileCollaboration } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/file-collaboration'
import { LinkEmbed } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/embed/link-embed'
import { createMarkdownContentExtensions } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/extensions'
import { RichMarkdownFind } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/find'
import {
  ResizableImage,
  ResizableInlineImage,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image'
import { ImageUploadPlaceholders } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/image-upload'
import { RichMarkdownKeymap } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/keymap'
import { MarkdownPaste } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-paste'
import { Mention } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/mention/mention'
import { MentionChip } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/mention/mention-chip'
import {
  createRichMarkdownPasteAdmission,
  type RichMarkdownPasteAdmissionOptions,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/paste-admission'
import {
  FootnoteDefWithView,
  RawHtmlBlockWithView,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/raw-markdown-snippet'
import { SlashCommand } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/slash-command/slash-command'

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
  pasteAdmission?: RichMarkdownPasteAdmissionOptions
}

/**
 * The full extension set for the live editor: the content extensions with their React node-view nodes
 * injected (code-block language picker, resizable image, mention chip) plus the UI-only extensions —
 * `CodeBlockHighlight` (Prism), `SlashCommand` (the `/` block menu), `Mention` (the `@` menu),
 * `RichMarkdownKeymap`, `MarkdownPaste`, `Placeholder`, `RichMarkdownFind` (the Cmd/Ctrl+F match
 * highlights), and — when `embeds` is set — `LinkEmbed` (media players for standalone links).
 *
 * Kept separate from `extensions.ts` so those node views (and the block registry the mention chip pulls
 * in for brand icons) stay out of the headless round-trip path, which only needs the schema.
 */
export function createMarkdownEditorExtensions({
  placeholder,
  embeds = false,
  collaboration,
  pasteAdmission,
}: MarkdownEditorExtensionOptions): Extensions {
  return [
    ...createMarkdownContentExtensions(
      {
        codeBlock: CodeBlockWithLanguage,
        image: ResizableImage,
        inlineImage: ResizableInlineImage,
        mention: MentionChip,
        rawHtmlBlock: RawHtmlBlockWithView,
        footnoteDef: FootnoteDefWithView,
      },
      { disableHistory: Boolean(collaboration) }
    ),
    ...(collaboration
      ? [
          FileCollaboration.configure({ document: collaboration.doc }),
          // CollaborationCaret reads only `provider.awareness` (created synchronously,
          // relayed by the socket provider once connected). `render` tags each caret
          // with the peer's client id and shows its name label; the selection tint is
          // a translucent fill of the peer's identity color.
          CollaborationCaret.configure({
            provider: { awareness: collaboration.awareness },
            user: collaboration.user,
            render: renderCaret,
            selectionRender: (user) => {
              const hex = typeof user.color === 'string' ? user.color : DEFAULT_CARET_COLOR
              return {
                class: 'collaboration-carets__selection',
                style: `background-color: ${withAlpha(hex, 0.2)};`,
              }
            },
          }),
          createCaretActivityExtension(collaboration.awareness),
        ]
      : []),
    CodeBlockHighlight,
    RichMarkdownFind,
    SlashCommand,
    Mention,
    RichMarkdownKeymap,
    BlockMover,
    ImageUploadPlaceholders,
    ...(pasteAdmission ? [createRichMarkdownPasteAdmission(pasteAdmission)] : []),
    MarkdownPaste,
    Placeholder.configure({ placeholder }),
    ...(embeds ? [LinkEmbed] : []),
  ]
}
