'use client'

import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { BrowserKnownSession } from '@sim/browser-protocol'
import type { BrowserCredentialMetadata, BrowserSiteInfo } from '@sim/desktop-bridge'
import { compareStrings } from '@sim/utils/string'
import { fuzzyMatch } from '@/components/workspace-sidebar/components/search-modal/utils'
import {
  useBrowserSearchSuggestions,
  useBrowserSuggestionSources,
} from '@/hooks/queries/browser-suggestions'
import { useDebounce } from '@/hooks/use-debounce'
import {
  googleSearchUrl,
  isSearchQueryInput,
  resolveUrlBarInput,
} from '@/platform/lib/data/browser-page-issue'

/** Rows the omnibox will show at once. */
const MAX_URL_SUGGESTIONS = 8
const SEARCH_SUGGESTIONS_DEBOUNCE_MS = 160
const OMNIBOX_DRAG_THRESHOLD_PX = 4

/**
 * How well the browser knows a host, strongest first. Ordering the corpus by this before recency is
 * what keeps a lightly-used imported site from outranking somewhere the user actually has an
 * account, and it is why imported hosts can be offered at all without drowning the real ones.
 */
export const SUGGESTION_TIER = {
  /** A saved password, or an agent sign-in this browser completed. */
  ACCOUNT: 2,
  /** Visited in this browser and still holding a cookie. */
  ACTIVE: 1,
  /** Known only from another browser the user imported. */
  IMPORTED: 0,
} as const

type SuggestionTier = (typeof SUGGESTION_TIER)[keyof typeof SUGGESTION_TIER]

export interface UrlSuggestion {
  hostname: string
  /** Where selecting the row navigates. */
  url: string
  /** What the site calls itself, learned from the source browser at import time. */
  name?: string
  /** Imported favicon as a data URL, when the source browser had one. */
  icon?: string
  /** Epoch ms of the most recent evidence, used to break ties by recency. */
  lastSeenAt: number
  tier: SuggestionTier
  /**
   * Source-browser visit count, carried over for every host the import knows, not only imported
   * ones: once {@link byConfidence} runs out of timestamps it is the only signal left in a tier.
   */
  visits?: number
}

export type OmniboxSuggestion =
  | ({ kind: 'site' } & UrlSuggestion)
  | { kind: 'search'; query: string; url: string }

function timestamp(value: string | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

/** A credential origin's hostname; a malformed origin is simply not suggested. */
function hostnameOf(origin: string): string | null {
  try {
    const { hostname } = new URL(origin)
    return hostname || null
  } catch {
    return null
  }
}

/**
 * Builds the omnibox's corpus from what the browser already knows.
 *
 * Two sources admit a host: a top-level visit in this browser that still has session evidence, or
 * positive aggregate visit evidence imported from the user's other browser. Saved credentials can
 * promote and decorate an admitted host, but cannot create a suggestion by themselves: owning a
 * password is not evidence that someone chose to visit the site. This stays an aggregate directory
 * rather than a history log: no page URL, visit timestamp or sequence is retained.
 */
export function mergeSuggestionSources(
  sessions: readonly BrowserKnownSession[],
  credentials: readonly BrowserCredentialMetadata[],
  sites: readonly BrowserSiteInfo[] = []
): UrlSuggestion[] {
  const byHostname = new Map<string, UrlSuggestion>()
  const known = new Map(sites.map((site) => [site.hostname, site]))
  const visitedHosts = new Set(sessions.map((session) => session.hostname))
  for (const site of sites) {
    if (typeof site.visits === 'number' && Number.isFinite(site.visits) && site.visits > 0) {
      visitedHosts.add(site.hostname)
    }
  }

  const record = (hostname: string, tier: SuggestionTier, seenAt: number, icon?: string) => {
    const existing = byHostname.get(hostname)
    if (existing) {
      if (tier > existing.tier) existing.tier = tier
      existing.icon ??= icon
      existing.lastSeenAt = Math.max(existing.lastSeenAt, seenAt)
      return
    }
    const site = known.get(hostname)
    byHostname.set(hostname, {
      hostname,
      url: `https://${hostname}`,
      name: site?.name,
      icon: icon ?? site?.icon,
      lastSeenAt: seenAt,
      tier,
      visits: site?.visits,
    })
  }

  for (const credential of credentials) {
    const hostname = hostnameOf(credential.origin)
    if (!hostname || !visitedHosts.has(hostname)) continue
    record(
      hostname,
      SUGGESTION_TIER.ACCOUNT,
      Math.max(timestamp(credential.updatedAt), timestamp(credential.createdAt)),
      credential.icon
    )
  }

  for (const session of sessions) {
    if (!session.hostname) continue
    record(
      session.hostname,
      session.evidence === 'sign-in-completed' ? SUGGESTION_TIER.ACCOUNT : SUGGESTION_TIER.ACTIVE,
      timestamp(session.lastObservedAt)
    )
  }

  // Last, so a host with real evidence keeps the tier and timestamp that evidence earned it.
  for (const site of sites) {
    if (!site.hostname || !visitedHosts.has(site.hostname) || byHostname.has(site.hostname)) {
      continue
    }
    byHostname.set(site.hostname, {
      hostname: site.hostname,
      url: `https://${site.hostname}`,
      name: site.name,
      icon: site.icon,
      lastSeenAt: timestamp(site.importedAt),
      tier: SUGGESTION_TIER.IMPORTED,
      visits: site.visits,
    })
  }

  return [...byHostname.values()]
}

/**
 * Tier, then visits, then recency, then hostname, so the same corpus always comes back in the same
 * order. Tier leads because one import stamps every host with the newest timestamp in the corpus;
 * visits outrank recency because a password import flattens a whole tier's timestamps.
 */
function byConfidence(first: UrlSuggestion, second: UrlSuggestion): number {
  return (
    second.tier - first.tier ||
    (second.visits ?? 0) - (first.visits ?? 0) ||
    second.lastSeenAt - first.lastSeenAt ||
    compareStrings(first.hostname, second.hostname)
  )
}

/** The best score any of a host's names earns: its hostname, or what its own browser called it. */
function bestMatch(suggestion: UrlSuggestion, query: string): { matched: boolean; score: number } {
  const terms = suggestion.name ? [suggestion.hostname, suggestion.name] : [suggestion.hostname]
  let best = { matched: false, score: 0 }
  for (const term of terms) {
    const candidate = fuzzyMatch(term, query)
    if (candidate.matched && (!best.matched || candidate.score > best.score)) {
      best = { matched: true, score: candidate.score }
    }
  }
  return best
}

/**
 * Orders the corpus for what the user has typed so far. An empty query lists the best-known hosts;
 * otherwise the palette's matcher ranks them, treating `.` and `/` as word boundaries.
 */
export function rankSuggestions(
  suggestions: readonly UrlSuggestion[],
  query: string,
  limit: number = MAX_URL_SUGGESTIONS
): UrlSuggestion[] {
  const trimmed = query.trim()
  if (!trimmed) return [...suggestions].sort(byConfidence).slice(0, limit)
  const scored: Array<{ suggestion: UrlSuggestion; score: number }> = []
  for (const suggestion of suggestions) {
    const { matched, score } = bestMatch(suggestion, trimmed)
    if (matched) scored.push({ suggestion, score })
  }
  scored.sort((a, b) => b.score - a.score || byConfidence(a.suggestion, b.suggestion))
  return scored.slice(0, limit).map((entry) => entry.suggestion)
}

/**
 * The exact typed search leads, known sites keep priority, and live completions fill whatever room
 * remains.
 */
export function buildOmniboxSuggestions(
  siteCorpus: readonly UrlSuggestion[],
  rawQuery: string,
  searchCompletions: readonly string[] = [],
  limit: number = MAX_URL_SUGGESTIONS
): OmniboxSuggestion[] {
  if (limit <= 0) return []
  const query = rawQuery.trim()
  const sites = rankSuggestions(siteCorpus, query, limit)
  if (!query || !isSearchQueryInput(query)) {
    return sites.map((site) => ({ ...site, kind: 'site' }))
  }

  const results: OmniboxSuggestion[] = [{ kind: 'search', query, url: googleSearchUrl(query) }]
  for (const site of sites) {
    if (results.length === limit) return results
    results.push({ ...site, kind: 'site' })
  }

  const seen = new Set([query.toLocaleLowerCase()])
  for (const candidate of searchCompletions) {
    const completion = candidate.trim()
    const key = completion.toLocaleLowerCase()
    if (!completion || seen.has(key)) continue
    seen.add(key)
    results.push({ kind: 'search', query: completion, url: googleSearchUrl(completion) })
    if (results.length === limit) break
  }
  return results
}

/** Where the arrow keys land next; both ends wrap, and no highlight enters from the near end. */
function moveActiveIndex(current: number | null, delta: number, count: number): number | null {
  if (count <= 0) return null
  if (current === null) return delta > 0 ? 0 : count - 1
  const next = current + delta
  if (next < 0) return count - 1
  if (next >= count) return 0
  return next
}

/** Typed searches and new tabs select the first row; an untouched page URL remains literal. */
function initialActiveIndex(pageUrl: string, count: number, query: string): number | null {
  if (count === 0) return null
  return query.trim() || !pageUrl || pageUrl === 'about:blank' ? 0 : null
}

/** Puts the caret at the end so a later focus does not keep a stale whole-value selection. */
function clearSelection(input: HTMLInputElement) {
  const end = input.value.length
  input.setSelectionRange(end, end)
}

/** The panel's capture-and-hide handshake for a renderer list that hangs over the native page. */
interface OmniboxOverlay {
  open: boolean
  request: () => void
  close: () => void
}

interface BrowserOmniboxOptions {
  /** The page's address, or empty on a blank tab. */
  pageUrl: string
  panelVisible: boolean
  /** Sim draws its own view in place of the page, so there is no native view to hide. */
  rendererPage: boolean
  /** A permission prompt or page prompt owns the panel. */
  blocked: boolean
  overlay: OmniboxOverlay
  inputRef: RefObject<HTMLInputElement | null>
  onNavigate: (url: string) => void
}

interface PointerSelection {
  pointerId: number
  originX: number
  originY: number
}

/**
 * The legacy browser's address bar: focusing it lists the best-known hosts, typing ranks them with
 * the exact search and debounced live completions, arrows wrap through the rows and Escape backs out
 * a step at a time. The list hangs over the native page, so it opens only once the panel has swapped
 * the page for its captured frame; a failed handshake keeps it closed rather than unclickable.
 */
export function useBrowserOmnibox({
  pageUrl,
  panelVisible,
  rendererPage,
  blocked,
  overlay,
  inputRef,
  onNavigate,
}: BrowserOmniboxOptions) {
  /** Non-null while the user is editing; otherwise the bar mirrors the page. */
  const [draft, setDraft] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  /** Page URL captured when the current edit began. */
  const [originUrl, setOriginUrl] = useState('')
  const [visible, setVisible] = useState(false)
  /** Empty on focus; follows the typed text once the user edits it. */
  const [query, setQuery] = useState<string | null>(null)
  const debouncedQuery = useDebounce(query ?? '', SEARCH_SUGGESTIONS_DEBOUNCE_MS).trim()
  const pointerSelection = useRef<PointerSelection | null>(null)

  // Re-read whenever the panel comes back on screen, so an import or a fresh sign-in shows up.
  const sources = useBrowserSuggestionSources(panelVisible)
  const corpus = useMemo(
    () =>
      sources.data
        ? mergeSuggestionSources(
            sources.data.sessions,
            sources.data.credentials,
            sources.data.sites
          )
        : [],
    [sources.data]
  )
  const searchingLive = visible && isSearchQueryInput(debouncedQuery)
  const completions = useBrowserSearchSuggestions(debouncedQuery, searchingLive)

  const suggestions = useMemo((): OmniboxSuggestion[] => {
    if (!visible || query === null) return []
    // Completions for text the user has since changed never stand in for the current text's.
    const live = searchingLive && debouncedQuery === query.trim() ? (completions.data ?? []) : []
    return buildOmniboxSuggestions(corpus, query, live)
  }, [completions.data, corpus, debouncedQuery, query, searchingLive, visible])

  // A new list, query or edit starts its highlight over; hover and arrows move it within one.
  const [highlightFor, setHighlightFor] = useState<{
    originUrl: string
    query: string | null
    suggestions: OmniboxSuggestion[]
  } | null>(null)
  if (
    highlightFor === null ||
    highlightFor.originUrl !== originUrl ||
    highlightFor.query !== query ||
    highlightFor.suggestions !== suggestions
  ) {
    setHighlightFor({ originUrl, query, suggestions })
    setActiveIndex(initialActiveIndex(originUrl, suggestions.length, query ?? ''))
  }

  const { request, close } = overlay
  useEffect(() => {
    if (blocked || rendererPage || suggestions.length === 0) close()
    else request()
  }, [blocked, rendererPage, suggestions.length, request, close])

  // The page is a separate native view, so clicking it blurs this window without blurring the input.
  useEffect(() => {
    const handleWindowBlur = () => {
      const input = inputRef.current
      if (!input) return
      clearSelection(input)
      input.blur()
    }
    window.addEventListener('blur', handleWindowBlur)
    return () => window.removeEventListener('blur', handleWindowBlur)
  }, [inputRef])

  const open = suggestions.length > 0 && (rendererPage || (!blocked && overlay.open))

  const reset = () => {
    setVisible(false)
    setQuery(null)
    setActiveIndex(null)
    setOriginUrl('')
  }

  const navigate = (url: string) => {
    onNavigate(url)
    reset()
    inputRef.current?.blur()
  }

  const selectOnNextFrame = (input: HTMLInputElement) => {
    requestAnimationFrame(() => {
      if (document.activeElement === input) input.select()
    })
  }

  return {
    value: draft ?? pageUrl,
    suggestions,
    open,
    activeIndex: open ? activeIndex : null,
    choose: (suggestion: OmniboxSuggestion) => navigate(suggestion.url),
    hover: (index: number) => setActiveIndex(index),
    dismiss: () => {
      reset()
      inputRef.current?.blur()
    },
    /** Enter takes a highlight only from a list the user can see. */
    submit: () => {
      const highlighted = open && activeIndex !== null ? suggestions[activeIndex] : undefined
      if (highlighted) {
        navigate(highlighted.url)
        return
      }
      const raw = (draft ?? '').trim()
      if (raw) {
        navigate(resolveUrlBarInput(raw))
        return
      }
      inputRef.current?.blur()
    },
    onChange: (next: string) => {
      setVisible(true)
      setQuery(next)
      setDraft(next)
      setActiveIndex(null)
    },
    onFocus: (input: HTMLInputElement) => {
      setDraft((current) => current ?? pageUrl)
      setOriginUrl(pageUrl)
      setQuery('')
      if (!pointerSelection.current) selectOnNextFrame(input)
    },
    onBlur: (input: HTMLInputElement) => {
      pointerSelection.current = null
      clearSelection(input)
      reset()
      setDraft(null)
    },
    /**
     * A click opts into suggestions and selects the whole address unless it starts a drag. The
     * pointer and key handlers sit on the field's wrapper and act only on events from the input.
     */
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      const input = inputRef.current
      if (!input || event.target !== input) return
      pointerSelection.current =
        event.button === 0 && document.activeElement !== input
          ? { pointerId: event.pointerId, originX: event.clientX, originY: event.clientY }
          : null
      setVisible(true)
      if (document.activeElement !== input || query === null) {
        setOriginUrl(pageUrl)
        setQuery('')
      }
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const pending = pointerSelection.current
      const input = inputRef.current
      if (!pending || !input || pending.pointerId !== event.pointerId) return
      if (
        input.selectionStart !== input.selectionEnd ||
        Math.hypot(event.clientX - pending.originX, event.clientY - pending.originY) >
          OMNIBOX_DRAG_THRESHOLD_PX
      ) {
        pointerSelection.current = null
      }
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const pending = pointerSelection.current
      pointerSelection.current = null
      if (pending?.pointerId === event.pointerId && event.button === 0) inputRef.current?.select()
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const input = inputRef.current
      if (!input || event.target !== input) return
      event.stopPropagation()
      // Keys during an IME composition edit the composed text, not the address.
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!open) return
        event.preventDefault()
        setActiveIndex((current) =>
          moveActiveIndex(current, event.key === 'ArrowDown' ? 1 : -1, suggestions.length)
        )
        return
      }
      if (event.key !== 'Escape') return
      // Back out one step at a time, as Chrome does: the highlight, the edited text, the bar.
      if (activeIndex !== null) {
        setActiveIndex(null)
      } else if ((draft ?? '') !== pageUrl) {
        setDraft(pageUrl)
        setVisible(false)
        selectOnNextFrame(input)
      } else {
        input.blur()
      }
    },
  }
}
