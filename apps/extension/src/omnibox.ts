import {
  SIM_LINK_SUGGESTIONS_PATH,
  simLinkSuggestionsSchema,
} from '@sim/browser-extension-protocol'
import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { LRUCache } from 'lru-cache'
import { SIM_ORIGIN } from '@/config'

const logger = createLogger('BrowserExtensionOmnibox')

/** Longer than the gap between a typist's keystrokes, so a name is looked up once it settles. */
const SUGGEST_DELAY_MS = 220

/** Link names are at most this long, so nothing longer can match. */
const MAX_NAME_LENGTH = 64

/** A Sim link as suggested: its name, and what it shows beside the name. */
interface SuggestedLink {
  name: string
  detail: string
}

/**
 * What was typed after the `sim` keyword, split where the name ends: `sim/jira/ABC-1?tab=all`
 * (the `sim/` is optional) has the name `jira` and the rest `/ABC-1?tab=all`. Surrounding spaces,
 * the prefix, leading slashes, and any `#fragment` are dropped, as the address bar would; values
 * and the query otherwise stay exactly as typed.
 */
function readTyped(text: string): { name: string; rest: string } {
  const typed = text
    .trim()
    .replace(/^sim\//i, '')
    .replace(/^\/+/, '')
    .replace(/#.*$/, '')
  const nameEnd = typed.search(/[/?]/)
  return nameEnd === -1
    ? { name: typed, rest: '' }
    : { name: typed.slice(0, nameEnd), rest: typed.slice(nameEnd) }
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** Code points XML forbids even as references, besides lone surrogates. */
const NON_XML_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g

/**
 * Suggestion text is XML, where these five characters are markup and some code points aren't
 * allowed at all, so one bad description can't make Chrome drop every suggestion.
 */
function escapeXml(text: string): string {
  return text
    .replace(NON_XML_CHARACTER, '')
    .replace(LONE_SURROGATE, '')
    .replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)
}

/** `encodeURIComponent`, except a lone surrogate (which it refuses) is dropped. */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment.replace(LONE_SURROGATE, ''))
}

/**
 * The resolver address for what was typed, as the address bar would send `sim/<typed>`: each
 * `/` starts a value, kept in position even when empty, and a trailing `/` adds none.
 */
function simLinkUrl(text: string): string {
  const { name, rest } = readTyped(text)
  const queryStart = rest.indexOf('?')
  const path = `${name}${queryStart === -1 ? rest : rest.slice(0, queryStart)}`.replace(/\/$/, '')
  const query = queryStart === -1 ? '' : new URLSearchParams(rest.slice(queryStart + 1)).toString()
  const segments = path ? path.split('/').map(encodeSegment) : []
  return `${SIM_ORIGIN}/${['sim', ...segments].join('/')}${query ? `?${query}` : ''}`
}

/** The links Sim suggests for `name`, or `null` when it couldn't answer (signed out, rate limited). */
async function fetchSuggestedLinks(
  name: string,
  signal: AbortSignal
): Promise<SuggestedLink[] | null> {
  const response = await fetch(
    `${SIM_ORIGIN}${SIM_LINK_SUGGESTIONS_PATH}?${new URLSearchParams({ q: name })}`,
    { credentials: 'include', signal }
  )
  if (!response.ok) return null
  const { links } = simLinkSuggestionsSchema.parse(await response.json())
  return links.map((link) => ({ name: link.name, detail: link.description ?? link.url }))
}

/** Each link as a suggestion that keeps whatever was typed after the name. */
function toSuggestions(
  links: readonly SuggestedLink[],
  rest: string
): chrome.omnibox.SuggestResult[] {
  return links.map((link) => ({
    content: `${link.name}${rest}`,
    description: `<match>sim/${escapeXml(`${link.name}${rest}`)}</match> <dim>${escapeXml(link.detail)}</dim>`,
  }))
}

/**
 * The `sim` address-bar keyword: `sim`, then Space, lists matching Sim links as you type, and
 * Enter opens what was typed through the resolver, which sends a missing link to its create form.
 */
export function registerSimLinkOmnibox() {
  let pending: AbortController | null = null
  /**
   * Links by typed name, emptied as each keyword session starts, so editing values or retyping
   * a name in one session asks Sim once per name.
   */
  const linksByName = new LRUCache<string, SuggestedLink[]>({ max: 100 })

  chrome.omnibox.onInputStarted.addListener(() => linksByName.clear())

  chrome.omnibox.onInputChanged.addListener((text, suggest) => {
    pending?.abort()
    const { name, rest } = readTyped(text)
    chrome.omnibox.setDefaultSuggestion({
      description: `Open <match>sim/${escapeXml(`${name}${rest}`)}</match>`,
    })
    // A name can't hold a space, so `sim card prices` is a search, not a link: ask Sim nothing.
    if (/\s/.test(name) || name.length > MAX_NAME_LENGTH) {
      suggest([])
      return
    }
    const key = name.toLowerCase()
    const known = linksByName.get(key)
    if (known) {
      suggest(toSuggestions(known, rest))
      return
    }
    const controller = new AbortController()
    pending = controller
    void (async () => {
      await sleep(SUGGEST_DELAY_MS)
      if (controller.signal.aborted) return
      // Signed out or rate limited: the typed link still opens through the resolver, and the name
      // is asked about again on the next keystroke rather than remembered as having no links.
      const links = await fetchSuggestedLinks(key, controller.signal)
      if (links) linksByName.set(key, links)
      if (!controller.signal.aborted) suggest(toSuggestions(links ?? [], rest))
    })().catch(() => {
      if (!controller.signal.aborted) logger.warn('Could not load Sim link suggestions')
    })
  })

  chrome.omnibox.onInputCancelled.addListener(() => pending?.abort())

  chrome.omnibox.onInputEntered.addListener((text, disposition) => {
    pending?.abort()
    const url = simLinkUrl(text)
    const opened =
      disposition === 'currentTab'
        ? chrome.tabs.update({ url })
        : chrome.tabs.create({ url, active: disposition === 'newForegroundTab' })
    void opened.catch(() => logger.warn('Could not open the Sim link'))
  })
}
