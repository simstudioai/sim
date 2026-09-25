import { convert, type HtmlToTextOptions } from 'html-to-text'
import { decodeHtmlEntities, htmlToPlainText, looksLikeHtml } from '@/connectors/utils'

/**
 * How a provider encodes a text field: `plain` is used as-is, `escaped` is HTML-escaped text
 * without markup (Gmail snippets), `html` is markup, and `auto` treats the value as markup only
 * when it carries real HTML tags (Calendar descriptions may be either).
 */
type ProviderTextFormat = 'plain' | 'escaped' | 'html' | 'auto'

/**
 * Invisible format characters that marketing mail pads preheaders with. A zero-width joiner
 * followed by a pictograph is kept because it composes a single emoji. The combining grapheme
 * joiner is its own alternative because it cannot share a character class with base characters.
 */
const INVISIBLE_CHARACTER =
  '[\\u00AD\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180E\\u200B\\u200C\\u200E\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u206F\\u3164\\uFEFF\\uFFA0]|\\u034F|\\u200D(?!\\p{Extended_Pictographic})'
/**
 * A run of invisible characters with the spaces between them, as preheader padding is built.
 * The lookbehind starts a match only at the beginning of a space run, which keeps long runs of
 * spaces linear instead of rescanning them from every position.
 */
const INVISIBLE_RUN = new RegExp(
  `(?<![^\\S\\n\\uFEFF])(?:[^\\S\\n\\uFEFF]*(?:${INVISIBLE_CHARACTER}))+[^\\S\\n\\uFEFF]*`,
  'gu'
)
/** Trailing spaces on a line, matched only from the start of their run for the same reason. */
const TRAILING_SPACES = /(?<![^\S\n])[^\S\n]+$/gm
/** A lone joiner or direction mark inside a word shapes it (Persian, Indic, Hebrew, Arabic). */
const MEANINGFUL_MARK = /^(?:\u200C|\u200D|\u200E|\u200F|\u061C|[\u2066-\u2069])$/u
/** Real whitespace; the byte-order mark counts as whitespace in JavaScript but is not spacing. */
const SPACING = /[^\S\uFEFF]/

/**
 * Markup becomes text only: links keep their visible text, non-text elements are dropped, each
 * table row keeps its cells on one line, and nesting depth is bounded.
 */
const HTML_TO_TEXT: HtmlToTextOptions = {
  wordwrap: false,
  limits: { maxDepth: 512 },
  formatters: {
    cell(element, walk, builder) {
      walk(element.children, builder)
      builder.addInline(' ', { noWordTransform: true })
    },
  },
  selectors: [
    { selector: 'a', options: { ignoreHref: true } },
    { selector: 'img', format: 'skip' },
    { selector: 'script', format: 'skip' },
    { selector: 'style', format: 'skip' },
    { selector: 'table', format: 'block' },
    { selector: 'tr', format: 'block' },
    { selector: 'td', format: 'cell' },
    { selector: 'th', format: 'cell' },
    { selector: 'dt', format: 'block' },
    { selector: 'dd', format: 'block' },
    ...(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const).map((selector) => ({
      selector,
      options: { uppercase: false },
    })),
  ],
}

/** Markup the converter cannot walk keeps its text through the flat tag-stripping path. */
function markupText(html: string): string {
  try {
    return convert(html, HTML_TO_TEXT)
  } catch {
    return htmlToPlainText(html)
  }
}

/**
 * Normalizes provider text into readable plain text for previews and document reads. Markup is
 * never rendered: tags are dropped and entities decoded into literal characters.
 */
export function providerText(value: string, format: ProviderTextFormat = 'plain'): string {
  let text = value
  if (format === 'html' || (format === 'auto' && looksLikeHtml(text))) {
    text = markupText(text)
  } else if (format === 'escaped') {
    text = decodeHtmlEntities(text)
  }
  /** Padding collapses to one space; a stray mark inside a word is dropped unless it shapes it. */
  text = text.replace(INVISIBLE_RUN, (run) =>
    SPACING.test(run) ? ' ' : MEANINGFUL_MARK.test(run) ? run : ''
  )
  if (format === 'escaped') return text.replace(/\s+/g, ' ').trim()
  return text
    .replace(TRAILING_SPACES, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
}
