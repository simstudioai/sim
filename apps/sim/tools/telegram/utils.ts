/**
 * Build a Telegram Bot API method URL for the given bot token.
 */
export function telegramApiUrl(botToken: string, method: string): string {
  return `https://api.telegram.org/bot${botToken}/${method}`
}

/**
 * Tags Telegram's HTML parse mode accepts; any other `<...>` makes the whole send fail. Telegram
 * ignores attributes it does not know, but rejects a `<span>` whose class is not `tg-spoiler`.
 */
const SUPPORTED_TAG =
  /<\/?(?:b|strong|i|em|u|ins|s|strike|del|tg-spoiler|a|tg-emoji|tg-time|code|pre|blockquote)(?:\s[^<>]*)?>|<span\s(?:[^<>]*\s)?class\s*=\s*(?:"tg-spoiler"|'tg-spoiler'|tg-spoiler(?=[\s>]))[^<>]*>|<\/span\s*>/gi

/** Entities Telegram's HTML parse mode accepts: any numeric one plus `&lt;`, `&gt;`, `&amp;`, `&quot;`. */
const SUPPORTED_ENTITY = /&(?!(?:#\d+|#x[\da-f]+|lt|gt|amp|quot);)/gi

/** Characters that join a word, so an `_` between two of them is part of the word, not emphasis. */
const WORD_EDGE_BEFORE = '(?<![\\p{L}\\p{N}_])'
const WORD_EDGE_AFTER = '(?![\\p{L}\\p{N}_])'
const UNDERSCORE_BOLD = new RegExp(`${WORD_EDGE_BEFORE}__(.*?)__${WORD_EDGE_AFTER}`, 'gu')
const UNDERSCORE_ITALIC = new RegExp(`${WORD_EDGE_BEFORE}_(.*?)_${WORD_EDGE_AFTER}`, 'gu')

const PLACEHOLDER = /\u0000(\d+)\u0000/g

function escapeHtmlText(text: string): string {
  return text.replace(SUPPORTED_ENTITY, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Converts light markdown (bold, italic, code, links) to Telegram's HTML parse mode. Supported
 * HTML tags the text already contains pass through; every other `<`, `>` and `&` is escaped, as
 * Telegram rejects the message otherwise. Tags, code spans and link URLs are set aside before the
 * emphasis rules run, so an `_` or `*` inside them is never turned into `<i>`/`<b>`. NUL characters
 * are dropped.
 */
export function convertMarkdownToHTML(input: string): string {
  // NUL marks a set-aside segment below, and Telegram reads it as the end of the text anyway.
  const text = input.replace(/\u0000/g, '')
  const protectedSegments: string[] = []
  const protect = (segment: string) => `\u0000${protectedSegments.push(segment) - 1}\u0000`
  const restore = (value: string, present: (segment: string) => string) =>
    value.replace(PLACEHOLDER, (match, index: string) => {
      const segment = protectedSegments[Number(index)]
      return segment === undefined ? match : present(segment)
    })
  /** Code spans and link URLs hold plain text, so a tag already set aside inside one is shown escaped. */
  const asLiteral = (value: string) => restore(value, escapeHtmlText)

  let tagStart = 0
  let escaped = ''
  for (const match of text.matchAll(SUPPORTED_TAG)) {
    escaped += escapeHtmlText(text.slice(tagStart, match.index)) + protect(match[0])
    tagStart = match.index + match[0].length
  }
  escaped += escapeHtmlText(text.slice(tagStart))

  return restore(
    escaped
      // Code: `text` -> <code>text</code>
      .replace(/`(.*?)`/g, (_match, code: string) => protect(`<code>${asLiteral(code)}</code>`))
      // Links: [text](url) -> <a href="url">text</a>
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_match, label: string, url: string) =>
          `${protect(`<a href="${asLiteral(url).replace(/"/g, '&quot;')}">`)}${label}</a>`
      )
      // Bold: **text** or __text__ -> <b>text</b>
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(UNDERSCORE_BOLD, '<b>$1</b>')
      // Italic: *text* or _text_ -> <i>text</i>
      .replace(/\*(.*?)\*/g, '<i>$1</i>')
      .replace(UNDERSCORE_ITALIC, '<i>$1</i>'),
    (segment) => segment
  )
}
