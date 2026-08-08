/**
 * Composer autocomplete: trigger detection, ranking and windowing.
 *
 * Pure and ANSI-free so it can be unit tested without a terminal; the caller
 * owns painting. Tags stay plain draft text while their selected identities
 * travel beside the draft. Submit keeps an identity only while its exact tag
 * remains, so a half-deleted tag degrades to literal text instead of a dangling
 * resource reference.
 */

import type { ChatBody } from '../../generated/v2-api.js'

export type ChatContext = NonNullable<ChatBody['contexts']>[number]

/** One row in the suggestion list. */
export interface SuggestionItem {
  /** Stable across refreshes — selection is tracked by id, never by index. */
  id: string
  /** What the user picks, and what gets written into the draft. */
  value: string
  displayText: string
  description?: string
  tag?: string
  /** Exact identity sent beside the prompt when this tag remains present. */
  context?: ChatContext
}

export interface ChatSuggestionCandidates {
  resources: SuggestionItem[]
  slash: SuggestionItem[]
}

export interface CompletionToken {
  /** Includes the trigger character. */
  token: string
  /** Index of the trigger character within the draft. */
  startPos: number
  /** Text after the trigger, i.e. what to filter on. */
  query: string
  trigger: '/' | '@'
}

const MENTION_QUERY_BOUNDARY = /[\s.,;:!?(){}[\]"'`/\\<>]/u
const SLASH_QUERY_BOUNDARY = /[\s.,;:!?(){}[\]"'`\\<>]/u
const TAG_END_BOUNDARY = /^[\s.,;:!?(){}[\]"'`/\\<>]/u

/**
 * Walk backwards from the cursor to find an open completion context.
 *
 * A trigger only counts at the start of the draft or after whitespace, so an
 * email address in prose cannot open a mention. Returns null when the cursor is
 * not inside a completion.
 */
export function extractCompletionToken(text: string, cursor: number): CompletionToken | null {
  const before = text.slice(0, Math.max(0, Math.min(cursor, text.length)))
  for (let index = before.length - 1; index >= 0; index -= 1) {
    const trigger = before[index]
    if (trigger !== '@' && trigger !== '/') continue
    if (index > 0 && !/\s/u.test(before[index - 1] as string)) continue

    const query = before.slice(index + 1)
    const boundary = trigger === '@' ? MENTION_QUERY_BOUNDARY : SLASH_QUERY_BOUNDARY
    if (boundary.test(query)) return null
    return { token: before.slice(index), startPos: index, query, trigger }
  }
  return null
}

/**
 * Filter like the home composer: a case-insensitive name substring while
 * preserving source order. A leading trigger on local CLI commands is ignored.
 */
export function rankSuggestions(query: string, candidates: SuggestionItem[]): SuggestionItem[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...candidates]
  return candidates.filter((item) =>
    item.value.replace(/^[/@]/u, '').toLowerCase().includes(needle)
  )
}

/**
 * Visible slice for a list taller than the panel, centred on the selection so
 * the cursor sits mid-list rather than only scrolling at the edges.
 */
export function suggestionWindow(
  total: number,
  selected: number,
  maxVisible: number
): { start: number; end: number } {
  if (total <= maxVisible) return { start: 0, end: total }
  const start = Math.max(0, Math.min(selected - Math.floor(maxVisible / 2), total - maxVisible))
  return { start, end: start + maxVisible }
}

/** The home composer inserts literal multiword labels and carries identity separately. */
export function formatMention(value: string): string {
  return `@${value}`
}

/** Splice an accepted suggestion over the trigger token. */
export function applySuggestion(
  draft: string,
  token: CompletionToken,
  replacement: string
): { draft: string; cursor: number } {
  const head = draft.slice(0, token.startPos)
  const tail = draft.slice(token.startPos + token.token.length)
  /* Only add the separating space when the draft does not already have one. */
  const inserted = /^\s/.test(tail) ? replacement : `${replacement} `
  return { draft: `${head}${inserted}${tail}`, cursor: head.length + inserted.length }
}

export function contextToken(context: ChatContext): string {
  return `${context.kind === 'skill' || context.kind === 'mcp' ? '/' : '@'}${context.label}`
}

function hasContextToken(text: string, context: ChatContext): boolean {
  const token = contextToken(context).toLowerCase()
  const haystack = text.toLowerCase()
  let start = haystack.indexOf(token)
  while (start >= 0) {
    const before = start === 0 ? '' : text[start - 1]
    const after = text[start + token.length]
    if ((!before || /\s/u.test(before)) && (!after || TAG_END_BOUNDARY.test(after))) return true
    start = haystack.indexOf(token, start + 1)
  }
  return false
}

/** Keeps selected identities only while their exact visible tag remains. */
export function presentContexts(text: string, contexts: ChatContext[]): ChatContext[] {
  return contexts.filter((context) => hasContextToken(text, context))
}

/**
 * Mirrors the client's typed/pasted `/name` auto-registration. Candidate order
 * is significant: skills precede MCP servers, so a same-name skill wins.
 */
export function resolveSlashContexts(text: string, candidates: SuggestionItem[]): ChatContext[] {
  const contexts: ChatContext[] = []
  const seenLabels = new Set<string>()
  for (const candidate of candidates) {
    const context = candidate.context
    if (!context || (context.kind !== 'skill' && context.kind !== 'mcp')) continue
    const label = context.label.toLowerCase()
    if (seenLabels.has(label)) continue
    seenLabels.add(label)
    if (hasContextToken(text, context)) contexts.push(context)
  }
  return contexts
}

/** Exact context-backed tags to paint as chips, longest first for overlaps. */
export function contextSpans(
  text: string,
  contexts: ChatContext[]
): Array<{ start: number; end: number }> {
  const tokens = [...new Set(contexts.map(contextToken))].sort(
    (left, right) => right.length - left.length
  )
  const ranges: Array<{ start: number; end: number }> = []
  const lower = text.toLowerCase()
  for (const token of tokens) {
    const needle = token.toLowerCase()
    let start = lower.indexOf(needle)
    while (start >= 0) {
      const before = start === 0 ? '' : text[start - 1]
      const after = text[start + token.length]
      const overlaps = ranges.some(
        (range) => start < range.end && start + token.length > range.start
      )
      if (
        (!before || /\s/u.test(before)) &&
        (!after || TAG_END_BOUNDARY.test(after)) &&
        !overlaps
      ) {
        ranges.push({ start, end: start + token.length })
      }
      start = lower.indexOf(needle, start + 1)
    }
  }
  return ranges.sort((left, right) => left.start - right.start)
}

/** Composer slash commands, the source for the `/` menu. */
export const SLASH_COMMANDS: SuggestionItem[] = [
  {
    id: 'new',
    value: '/new',
    displayText: '/new',
    description: 'start a new chat',
    tag: 'command',
  },
  {
    id: 'chats',
    value: '/chats',
    displayText: '/chats',
    description: 'view and switch chats',
    tag: 'command',
  },
  {
    id: 'rename',
    value: '/rename',
    displayText: '/rename <title>',
    description: 'rename the active chat',
    tag: 'command',
  },
  { id: 'help', value: '/help', displayText: '/help', description: 'show help', tag: 'command' },
  {
    id: 'exit',
    value: '/exit',
    displayText: '/exit',
    description: 'leave Sim Chat (alias: /quit)',
    tag: 'command',
  },
]
