import { convert, type HtmlToTextOptions } from 'html-to-text'
import { decodeHtmlEntities, looksLikeHtml } from '@/connectors/utils'

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
const INVISIBLE_CHARACTERS = new RegExp(
  [
    '[\\u00AD\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180E\\u200B\\u200C\\u200E\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u206F\\u3164\\uFEFF\\uFFA0]',
    '\\u034F',
    '\\u200D(?!\\p{Extended_Pictographic})',
  ].join('|'),
  'gu'
)

/** Markup becomes text only: links keep their visible text, and non-text elements are dropped. */
const HTML_TO_TEXT: HtmlToTextOptions = {
  wordwrap: false,
  selectors: [
    { selector: 'a', options: { ignoreHref: true } },
    { selector: 'img', format: 'skip' },
    { selector: 'script', format: 'skip' },
    { selector: 'style', format: 'skip' },
    ...(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const).map((selector) => ({
      selector,
      options: { uppercase: false },
    })),
  ],
}

/**
 * Normalizes provider text into readable plain text for previews and document reads. Markup is
 * never rendered: tags are dropped and entities decoded into literal characters.
 */
export function providerText(value: string, format: ProviderTextFormat = 'plain'): string {
  let text = value
  if (format === 'html' || (format === 'auto' && looksLikeHtml(text))) {
    text = convert(text, HTML_TO_TEXT)
  } else if (format === 'escaped') {
    text = decodeHtmlEntities(text)
  }
  return text
    .replace(INVISIBLE_CHARACTERS, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
