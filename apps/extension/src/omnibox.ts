import {
  SIM_LINK_SUGGESTIONS_PATH,
  simLinkSuggestionsSchema,
} from '@sim/browser-extension-protocol'
import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { SIM_ORIGIN } from '@/config'

const logger = createLogger('BrowserExtensionOmnibox')

/** Long enough to skip the requests a fast typist's intermediate keystrokes would make. */
const SUGGEST_DELAY_MS = 120

/** What was typed after the `sim` keyword, whether or not `sim/` was typed too. */
function typedSimLink(text: string): string {
  return text.trim().replace(/^sim\//i, '')
}

/** The name part, which alone decides the suggestions: `jira/ABC-1?x` suggests from `jira`. */
function typedName(text: string): string {
  return typedSimLink(text).split(/[/?]/)[0].toLowerCase()
}

/** Suggestion text is XML, where these five characters are markup. */
function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)
}

/**
 * The resolver address for what was typed after the `sim` keyword, written the way it is typed
 * in the address bar: `jira/ABC-1?tab=all` (with or without a leading `sim/`) opens
 * `sim/jira/ABC-1?tab=all`. Each `/` separates a value, and a value may contain spaces.
 */
function simLinkUrl(text: string): string {
  const typed = typedSimLink(text)
  const queryStart = typed.indexOf('?')
  const path = queryStart === -1 ? typed : typed.slice(0, queryStart)
  const query = queryStart === -1 ? '' : new URLSearchParams(typed.slice(queryStart + 1)).toString()
  const segments = path.split('/').filter(Boolean).map(encodeURIComponent)
  return `${SIM_ORIGIN}/${['sim', ...segments].join('/')}${query ? `?${query}` : ''}`
}

async function fetchSuggestions(
  name: string,
  signal: AbortSignal
): Promise<chrome.omnibox.SuggestResult[]> {
  const response = await fetch(
    `${SIM_ORIGIN}${SIM_LINK_SUGGESTIONS_PATH}?${new URLSearchParams({ q: name })}`,
    { credentials: 'include', signal }
  )
  // Signed out, or Sim links are unavailable: the typed link still opens through the resolver.
  if (!response.ok) return []
  const { links } = simLinkSuggestionsSchema.parse(await response.json())
  return links.map((link) => ({
    content: link.name,
    description: `<match>sim/${escapeXml(link.name)}</match> <dim>${escapeXml(link.description ?? link.url)}</dim>`,
  }))
}

/**
 * The `sim` address-bar keyword: `sim`, then Space, lists matching Sim links as you type, and
 * Enter opens what was typed through the resolver, which sends a missing link to its create form.
 */
export function registerSimLinkOmnibox() {
  let pending: AbortController | null = null
  /** Suggestions by typed name for the current keyword session, so retyping and editing values reuse them. */
  const suggestionsByName = new Map<string, chrome.omnibox.SuggestResult[]>()

  chrome.omnibox.onInputStarted.addListener(() => suggestionsByName.clear())

  chrome.omnibox.onInputChanged.addListener((text, suggest) => {
    pending?.abort()
    chrome.omnibox.setDefaultSuggestion({
      description: `Open <match>sim/${escapeXml(typedSimLink(text))}</match>`,
    })
    const name = typedName(text)
    const known = suggestionsByName.get(name)
    if (known) {
      suggest(known)
      return
    }
    const controller = new AbortController()
    pending = controller
    void (async () => {
      await sleep(SUGGEST_DELAY_MS)
      if (controller.signal.aborted) return
      const suggestions = await fetchSuggestions(name, controller.signal)
      suggestionsByName.set(name, suggestions)
      if (!controller.signal.aborted) suggest(suggestions)
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
