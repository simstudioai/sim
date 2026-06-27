import type { Extensions } from '@tiptap/core'
import Placeholder from '@tiptap/extension-placeholder'
import { CodeBlockWithLanguage } from './code-block'
import { CodeBlockHighlight } from './code-highlight'
import { createMarkdownContentExtensions } from './extensions'
import { ResizableImage } from './image'
import { RichMarkdownKeymap } from './keymap'
import { MarkdownPaste } from './markdown-paste'
import { Mention } from './mention/mention'
import { MentionChip } from './mention/mention-chip'
import { SlashCommand } from './slash-command/slash-command'

interface MarkdownEditorExtensionOptions {
  placeholder: string
}

/**
 * The full extension set for the live editor: the content extensions with their React node-view nodes
 * injected (code-block language picker, resizable image, mention chip) plus the UI-only extensions —
 * `CodeBlockHighlight` (Prism), `SlashCommand` (the `/` block menu), `Mention` (the `@` menu),
 * `RichMarkdownKeymap`, `MarkdownPaste`, and `Placeholder`.
 *
 * Kept separate from `extensions.ts` so those node views (and the block registry the mention chip pulls
 * in for brand icons) stay out of the headless round-trip path, which only needs the schema.
 */
export function createMarkdownEditorExtensions({
  placeholder,
}: MarkdownEditorExtensionOptions): Extensions {
  return [
    ...createMarkdownContentExtensions({
      codeBlock: CodeBlockWithLanguage,
      image: ResizableImage,
      mention: MentionChip,
    }),
    CodeBlockHighlight,
    SlashCommand,
    Mention,
    RichMarkdownKeymap,
    MarkdownPaste,
    Placeholder.configure({ placeholder }),
  ]
}
