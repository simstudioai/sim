import type { Extensions } from '@tiptap/core'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import Placeholder from '@tiptap/extension-placeholder'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { BlockMover } from '@/components/file-viewer/rich-markdown-editor/block-mover'
import { CodeBlockWithLanguage } from '@/components/file-viewer/rich-markdown-editor/code-block'
import { CodeBlockHighlight } from '@/components/file-viewer/rich-markdown-editor/code-highlight'
import {
  caretColorSlot,
  createCaretActivityExtension,
  renderCaret,
} from '@/components/file-viewer/rich-markdown-editor/collaboration/caret-presence'
import { FileCollaboration } from '@/components/file-viewer/rich-markdown-editor/collaboration/file-collaboration'
import { createMarkdownContentExtensions } from '@/components/file-viewer/rich-markdown-editor/extensions'
import { RichMarkdownFind } from '@/components/file-viewer/rich-markdown-editor/find/find-extension'
import {
  ResizableImage,
  ResizableInlineImage,
} from '@/components/file-viewer/rich-markdown-editor/image'
import { ImageUploadPlaceholders } from '@/components/file-viewer/rich-markdown-editor/image-upload'
import { RichMarkdownKeymap } from '@/components/file-viewer/rich-markdown-editor/keymap'
import { LinkEmbed } from '@/components/file-viewer/rich-markdown-editor/link-embed'
import { MarkdownPaste } from '@/components/file-viewer/rich-markdown-editor/markdown-paste'
import { Mention } from '@/components/file-viewer/rich-markdown-editor/mention'
import { MentionChip } from '@/components/file-viewer/rich-markdown-editor/mention-chip'
import {
  createRichMarkdownPasteAdmission,
  type RichMarkdownPasteAdmissionOptions,
} from '@/components/file-viewer/rich-markdown-editor/paste-admission'
import {
  FootnoteDefWithView,
  RawHtmlBlockWithView,
} from '@/components/file-viewer/rich-markdown-editor/raw-markdown-snippet'
import { SlashCommand } from '@/components/file-viewer/rich-markdown-editor/slash-command'

/** Older peers need a resolved colour for their selection tint, so it is resolved at mount. */
const FileCollaborationCaret = CollaborationCaret.extend({
  addProseMirrorPlugins() {
    const color = this.options.user.color
    const token = typeof color === 'string' ? /^var\((--[\w-]+)\)$/.exec(color)?.[1] : undefined
    if (token && typeof document !== 'undefined') {
      const resolved = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
      if (resolved) this.options.user = { ...this.options.user, color: resolved }
    }
    return this.parent?.() ?? []
  },
})

/** The live collaboration binding: Yjs history, and peers' carets and selections. */
interface EditorCollaboration {
  doc: Y.Doc
  awareness: Awareness
  user: { name: string; color: string }
}

interface MarkdownEditorExtensionOptions {
  placeholder: string
  collaboration?: EditorCollaboration
  pasteAdmission?: RichMarkdownPasteAdmissionOptions
}

/**
 * The live editor's extensions: the Markdown schema with its node views (code blocks, images,
 * mentions, raw snippets), Prism highlighting, the `/` and `@` menus, the keymap, find, media
 * embeds, image uploads, paste handling and, for a shared document, collaboration and carets.
 */
export function createMarkdownEditorExtensions({
  placeholder,
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
          FileCollaborationCaret.configure({
            provider: { awareness: collaboration.awareness },
            user: collaboration.user,
            render: renderCaret,
            selectionRender: (user) => {
              const slot = caretColorSlot(user.color)
              return {
                class: 'collaboration-carets__selection',
                ...(slot >= 0 ? { 'data-color-slot': String(slot) } : {}),
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
    LinkEmbed,
  ]
}
