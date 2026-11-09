import type { Extensions } from '@tiptap/core'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import Placeholder from '@tiptap/extension-placeholder'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { CodeBlockWithLanguage } from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/code-block'
import {
  ResizableImage,
  ResizableInlineImage,
} from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/image'
import { ImageUploadPlaceholders } from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/image-upload'
import { LinkEmbed } from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/link-embed'
import { Mention } from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/mention'
import { MentionChip } from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/mention-chip'
import {
  FootnoteDefWithView,
  RawHtmlBlockWithView,
} from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/raw-markdown-snippet'
import { SlashCommand } from '@/app/(product)/workspace/[workspaceId]/_components/rich-markdown-editor/slash-command'
import {
  caretColorSlot,
  createCaretActivityExtension,
  FileCollaboration,
  renderCaret,
} from '@/platform/lib/data/files/collaboration'
import {
  BlockMover,
  CodeBlockHighlight,
  createMarkdownContentExtensions,
  createRichMarkdownPasteAdmission,
  MarkdownPaste,
  RichMarkdownFind,
  RichMarkdownKeymap,
  type RichMarkdownPasteAdmissionOptions,
} from '@/platform/lib/data/files/markdown'

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
