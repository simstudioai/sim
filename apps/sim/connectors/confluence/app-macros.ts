import * as cheerio from 'cheerio'
import { htmlToPlainText } from '@/connectors/utils'

/**
 * Caelor Optics stores every module under one Connect macro and names the module
 * in its `macro` parameter. The HTML module keeps the page author's markup in
 * `contentByMode` (escaped JSON), and Confluence renders it only as an iframe
 * bootstrap script, so neither body format carries its text as page prose.
 */
const OPTICS_MACRO_NAME = 'caelor-optics-entry'

/** Every Connect app macro renders into this iframe container. */
const CONNECT_APP_CONTAINER = 'ap-container'

/** Markup whose text is never prose. Scripts are read for their data first. */
const NON_PROSE_SELECTOR = 'script, style, noscript, template'

/**
 * A string or number property of an object literal, introduced by `{` or `,` so
 * ternaries (`a ? 'x' : 'y'`) and `case 'x':` labels are not mistaken for data.
 * JSON objects match too, so both `{name: 'Zoom'}` and `{"name": "Zoom"}` read.
 */
const OBJECT_PROPERTY_PATTERN =
  /([{,])\s*(?:([A-Za-z_$][\w$]*)|"((?:[^"\\\r\n]|\\.)*)"|'((?:[^'\\\r\n]|\\.)*)')\s*:\s*(?:"((?:[^"\\\r\n]|\\.)*)"|'((?:[^'\\\r\n]|\\.)*)'|(-?\d+(?:\.\d+)?)(?![\w.]))/g

/** Values that are encoded payloads (inline images, fonts), not readable data. */
const MAX_UNBROKEN_VALUE_LENGTH = 200
const BASE64_ALPHABET_PATTERN = /^[A-Za-z0-9+/]{24,}={0,2}$/

/**
 * A string literal (kept, so a `//` inside `'https://…'` survives), a regex
 * literal (kept, so the `//` ending `/https?:\/\//` survives; recognized only
 * where an expression can start, so division is not mistaken for one), or a
 * comment (dropped, so commented-out records never read as page data).
 */
const STRING_OR_COMMENT_PATTERN =
  /("(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/(?<=(?:^|[=(,:;!&|?{}[\]+\-*%~^<>]|\breturn)\s*\/)(?![*/])(?:[^/\\\r\n[]|\\.|\[(?:[^\]\\\r\n]|\\.)*\])+\/[a-z]*)|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g

/**
 * Whether a rendered `view` body may hold an Optics HTML macro, whose text only
 * the storage body carries. Rendered Connect macros name themselves in
 * `data-macro-name`; a page left with no text but an app container is checked
 * too, so a rendering without that attribute still recovers. Other app pages
 * (draw.io, Lucidchart) that have prose skip the extra request.
 */
export function mayHoldOpticsHtmlMacro(viewHtml: string, viewText: string): boolean {
  return (
    viewHtml.includes(OPTICS_MACRO_NAME) ||
    (!viewText.trim() && viewHtml.includes(CONNECT_APP_CONTAINER))
  )
}

/** Parses a storage-format body, whose `ac:`/`ri:` elements and CDATA need lenient XML handling. */
export function loadStorageBody(storage: string): cheerio.CheerioAPI {
  return cheerio.load(
    storage,
    { xml: { xmlMode: false, recognizeCDATA: true, recognizeSelfClosing: true } },
    false
  )
}

/**
 * Text of a storage-format Optics HTML macro, or null when the element is any
 * other macro. The HTML is authored on the page itself, so it is the same for
 * every reader who can open the page.
 */
export function readOpticsHtmlMacroText(
  $: cheerio.CheerioAPI,
  element: Parameters<cheerio.CheerioAPI>[0]
): string | null {
  const macro = $(element)
  if (macro.attr('ac:name') !== OPTICS_MACRO_NAME) return null
  const parameter = (name: string) => macro.children(`ac\\:parameter[ac\\:name="${name}"]`)
  if (parameter('macro').text().trim() !== 'html') return null
  return readMarkupSources(parameter('contentByMode').text())
    .map(markupToText)
    .filter(Boolean)
    .join(' ')
}

/** Text of every Optics HTML macro in a storage-format body. */
export function extractOpticsHtmlMacroText(storage: string): string {
  if (!storage.includes(OPTICS_MACRO_NAME)) return ''
  const $ = loadStorageBody(storage)
  return $('ac\\:structured-macro')
    .toArray()
    .map((element) => readOpticsHtmlMacroText($, element))
    .filter(Boolean)
    .join(' ')
}

/**
 * `contentByMode` is JSON keyed by editor mode; its markup is whichever string
 * values contain tags. A value that is not JSON is read as markup directly.
 */
function readMarkupSources(content: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return [content]
  }
  const sources: string[] = []
  const collect = (value: unknown) => {
    if (typeof value === 'string') {
      if (/<[a-z!]/i.test(value)) sources.push(value)
    } else if (Array.isArray(value)) {
      value.forEach(collect)
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(collect)
    }
  }
  collect(parsed)
  return sources
}

/**
 * Visible text of authored markup followed by the data its scripts declare. A
 * page that renders a list from a JS object keeps nothing visible but a mount
 * point, so the object's properties are what a reader actually sees.
 */
function markupToText(markup: string): string {
  const $ = cheerio.load(markup)
  const scriptData = $('script')
    .toArray()
    .map((script) => readScriptData($(script).text()))
    .filter(Boolean)
  $(NON_PROSE_SELECTOR).replaceWith(' ')
  return [htmlToPlainText($.html()), ...scriptData].filter(Boolean).join(' ')
}

/** Object-literal properties as `key: value` lines, one line per object. */
function readScriptData(script: string): string {
  const records: string[][] = [[]]
  const code = script.replace(STRING_OR_COMMENT_PATTERN, (_, literal?: string) => literal ?? ' ')
  for (const match of code.matchAll(OBJECT_PROPERTY_PATTERN)) {
    const [, opener, bareKey, doubleKey, singleKey, doubleValue, singleValue, numberValue] = match
    const key = bareKey ?? unescapeJsString(doubleKey ?? singleKey ?? '')
    const value = numberValue ?? unescapeJsString(doubleValue ?? singleValue ?? '').trim()
    if (opener === '{') records.push([])
    if (key && isReadableValue(value)) records[records.length - 1].push(`${key}: ${value}`)
  }
  return records
    .filter((record) => record.length > 0)
    .map((record) => `${record.join(', ')}.`)
    .join(' ')
}

function isReadableValue(value: string): boolean {
  if (!value || value.startsWith('data:') || isBase64Payload(value)) return false
  return value.length <= MAX_UNBROKEN_VALUE_LENGTH || /\s/.test(value)
}

/**
 * Base64-alphabet runs that also carry the evidence of encoding: padding or
 * `+`/`/`, or the upper, lower, and digit mix random bytes produce. A long name
 * (`MicrosoftAuthenticationLibrary`) or numeric id has the alphabet but not this.
 */
function isBase64Payload(value: string): boolean {
  if (!BASE64_ALPHABET_PATTERN.test(value)) return false
  return /[+/=]/.test(value) || (/[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value))
}

const JS_ESCAPES: Record<string, string> = { n: ' ', r: ' ', t: ' ', b: '', f: '', v: '' }

function unescapeJsString(value: string): string {
  return value.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, sequence: string) => {
    if (sequence.length > 1) return String.fromCharCode(Number.parseInt(sequence.slice(1), 16))
    return JS_ESCAPES[sequence] ?? sequence
  })
}
