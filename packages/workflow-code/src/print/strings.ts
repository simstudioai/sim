/**
 * Literal escaping for printed source. Every function returns text whose cooked JS value is
 * exactly the input: the compiler reads cooked values, so `\`, quotes, `${`, CR,
 * U+2028/2029, other control characters, lone surrogates and the characters that reorder or hide
 * text in review ({@link isSuspiciousCharacter}) are escaped, while LF stays raw inside templates
 * so multi-line text reads naturally. Template content is never re-indented.
 */

import { isIdentifierName } from '../code-files/ref-path'

/**
 * Characters that reorder or hide text without a glyph of their own: bidi marks, embeddings and
 * isolates (U+061C, U+200E–U+200F, U+202A–U+202E, U+2066–U+2069), zero-width and invisible
 * characters (U+180E, U+200B–U+200D, U+2060–U+2064, U+FEFF) and the deprecated format controls
 * (U+206A–U+206F). The printer escapes them and compile warns on a block name holding one, so
 * printed text never reads differently from what it stores.
 */
function isSuspiciousCharacter(code: number): boolean {
  return (
    code === 0x061c ||
    code === 0x180e ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff
  )
}

/** Whether `text` holds a character {@link isSuspiciousCharacter} names. */
export function hasSuspiciousCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (isSuspiciousCharacter(text.charCodeAt(index))) return true
  }
  return false
}

function hex4(code: number): string {
  return `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`
}

/**
 * Escapes one UTF-16 code unit sequence. `mode` decides which characters are special: quoted
 * strings escape LF and their quote, templates escape the backtick and `${` instead.
 */
function escapeText(text: string, mode: 'single' | 'double' | 'template'): string {
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    const char = text[i] ?? ''
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += char + (text[i + 1] ?? '')
        i += 1
      } else {
        out += hex4(code)
      }
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      out += hex4(code)
      continue
    }
    switch (char) {
      case '\\':
        out += '\\\\'
        continue
      case '\r':
        out += '\\r'
        continue
      case '\u2028':
      case '\u2029':
        out += hex4(code)
        continue
      case '\n':
        out += mode === 'template' ? '\n' : '\\n'
        continue
      case '\t':
        out += mode === 'template' ? '\t' : '\\t'
        continue
      case "'":
        out += mode === 'single' ? "\\'" : "'"
        continue
      case '"':
        out += mode === 'double' ? '\\"' : '"'
        continue
      case '`':
        out += mode === 'template' ? '\\`' : '`'
        continue
      case '$':
        out += mode === 'template' && text[i + 1] === '{' ? '\\$' : '$'
        continue
    }
    if (code < 0x20 || code === 0x7f || isSuspiciousCharacter(code)) {
      out += hex4(code)
      continue
    }
    out += char
  }
  return out
}

/**
 * A quoted string literal. Single quotes unless the text holds more single than double quotes,
 * which is the quote Biome would pick (`quoteStyle: single`).
 */
export function quoteString(text: string): string {
  let singles = 0
  let doubles = 0
  for (const char of text) {
    if (char === "'") singles += 1
    else if (char === '"') doubles += 1
  }
  const quote = singles > doubles ? '"' : "'"
  return quote + escapeText(text, quote === '"' ? 'double' : 'single') + quote
}

/** The literal (cooked) part of a template between interpolations. */
export function escapeTemplateText(text: string): string {
  return escapeText(text, 'template')
}

/** An object key: bare when it is an identifier name, quoted otherwise (`quoteProperties: asNeeded`). */
export function printKey(key: string): string {
  return isIdentifierName(key) ? key : quoteString(key)
}

/** A member access segment: `.seg` for identifier names, `['seg']` otherwise. */
export function printMember(segment: string): string {
  return isIdentifierName(segment) ? `.${segment}` : `[${quoteString(segment)}]`
}

/** A JSON number as Biome prints a numeric literal (`String(n)` minus the exponent `+`). */
export function printNumber(value: number): string {
  return String(value).replace('e+', 'e')
}
