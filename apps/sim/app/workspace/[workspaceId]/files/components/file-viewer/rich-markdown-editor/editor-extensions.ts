import type { Extensions } from '@tiptap/core'
import Placeholder from '@tiptap/extension-placeholder'
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

interface MarkdownEditorExtensionOptions {
  placeholder: string
  /** Renders supported media links as live players beneath a standalone link. Off by default. */
  embeds?: boolean
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
}: MarkdownEditorExtensionOptions): Extensions {
  return [
    ...createMarkdownContentExtensions({
      codeBlock: CodeBlockWithLanguage,
      image: ResizableImage,
      mention: MentionChip,
      rawHtmlBlock: RawHtmlBlockWithView,
      footnoteDef: FootnoteDefWithView,
    }),
    CodeBlockHighlight,
    SlashCommand,
    Mention,
    RichMarkdownKeymap,
    MarkdownPaste,
    Placeholder.configure({ placeholder }),
    ...(embeds ? [LinkEmbed] : []),
  ]
}
