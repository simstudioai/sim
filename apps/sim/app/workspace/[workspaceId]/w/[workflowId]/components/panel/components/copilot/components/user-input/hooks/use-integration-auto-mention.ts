import { useCallback } from 'react'
import { getIntegrationMatcher } from '@/blocks/integration-matcher'
import type { ChatContext } from '@/stores/panel'

/**
 * Characters that signal the user has completed a word. Used by the
 * keystroke fast-path to detect that a typed integration name just ended.
 */
const WORD_BOUNDARY_REGEX = /^[\s.,;:!?(){}[\]"'`/\\<>\n]$/

type IntegrationContext = Extract<ChatContext, { kind: 'integration' }>

/**
 * A leading `@` only counts as a mention prefix when it itself starts a
 * token — i.e. at position 0 or after whitespace. This prevents email-like
 * patterns (`foo@slack`) from being chipped as `@Slack` mentions.
 */
function isMentionPrefixAt(text: string, atIndex: number): boolean {
  if (atIndex < 0 || text[atIndex] !== '@') return false
  if (atIndex === 0) return true
  return /\s/.test(text[atIndex - 1])
}

/**
 * Scans `text` for known integration names and rewrites each bare
 * occurrence to `@CanonicalName` (case-normalized). Names already
 * preceded by `@` are surfaced as contexts but not double-prefixed.
 */
function convertText(text: string): { text: string; contexts: IntegrationContext[] } {
  const { regex, byName } = getIntegrationMatcher()
  if (!regex || !text) return { text, contexts: [] }

  regex.lastIndex = 0
  const contexts: IntegrationContext[] = []
  const seen = new Set<string>()

  let result = ''
  let lastEnd = 0
  let mutated = false
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const info = byName.get(match[0].toLowerCase())
    if (!info) continue
    const atIndex = match.index - 1
    const hasAtChar = atIndex >= 0 && text[atIndex] === '@'
    // Email-like prefix (`foo@slack`): the `@` is not a token-starting
    // prefix. Skip entirely so we neither rewrite nor surface a context —
    // the downstream sync effect would strip it anyway and we'd just be
    // doing wasted work that flickers a chip for one render.
    if (hasAtChar && !isMentionPrefixAt(text, atIndex)) continue
    if (!seen.has(info.name)) {
      seen.add(info.name)
      contexts.push({ kind: 'integration', blockType: info.blockType, label: info.name })
    }
    const isPrefixed = hasAtChar
    // Skip rewrite when the match is already in canonical `@Slack` form;
    // otherwise rewrite (either insert `@` or canonicalize the casing).
    if (isPrefixed && match[0] === info.name) continue
    const replacement = isPrefixed ? info.name : `@${info.name}`
    result += text.slice(lastEnd, match.index) + replacement
    lastEnd = match.index + match[0].length
    mutated = true
  }

  if (!mutated) return { text, contexts }
  return { text: result + text.slice(lastEnd), contexts }
}

interface UseIntegrationAutoMentionProps {
  setSelectedContexts: React.Dispatch<React.SetStateAction<ChatContext[]>>
}

interface ProcessChangeArgs {
  textarea: HTMLTextAreaElement
  previousValue: string
  nextValue: string
}

/**
 * Auto-converts organic integration names (`Slack`, `AWS Textract`,
 * `Gmail`, any casing) into proper `@CanonicalName` mentions so they
 * render with the exact same chip UI as resource mentions — preserving
 * caret alignment, undo grouping, and copy/paste round-tripping.
 *
 * Two entry points share one dedup helper:
 * - `processChange`: keystroke fast-path. Detects a typed word-boundary
 *   char that just completed an integration name and rewrites the
 *   textarea in a single `setRangeText` edit (joined with the typed
 *   boundary char in native undo history).
 * - `applyToText`: bulk path for paste, template insertion, draft
 *   restore, speech-to-text, and any other programmatic value source.
 *   Idempotent — running on already-converted text is a no-op.
 */
export function useIntegrationAutoMention({ setSelectedContexts }: UseIntegrationAutoMentionProps) {
  const mergeContexts = useCallback(
    (additions: IntegrationContext[]) => {
      if (additions.length === 0) return
      setSelectedContexts((prev) => {
        const existing = new Set(prev.filter((c) => c.kind === 'integration').map((c) => c.label))
        const fresh = additions.filter((c) => !existing.has(c.label))
        return fresh.length > 0 ? [...prev, ...fresh] : prev
      })
    },
    [setSelectedContexts]
  )

  const processChange = useCallback(
    ({ textarea, previousValue, nextValue }: ProcessChangeArgs): string => {
      if (nextValue.length !== previousValue.length + 1) return nextValue

      let diffIndex = 0
      while (
        diffIndex < previousValue.length &&
        previousValue[diffIndex] === nextValue[diffIndex]
      ) {
        diffIndex++
      }

      const inserted = nextValue[diffIndex]
      if (!inserted || !WORD_BOUNDARY_REGEX.test(inserted)) return nextValue

      // Scan the segment immediately preceding the boundary char for an
      // integration name that ends at the boundary (i.e. just completed).
      const before = nextValue.slice(0, diffIndex)
      const { regex, byName } = getIntegrationMatcher()
      if (!regex) return nextValue

      regex.lastIndex = 0
      let completed: { start: number; end: number; name: string } | null = null
      let match: RegExpExecArray | null
      while ((match = regex.exec(before)) !== null) {
        if (match.index + match[0].length === before.length) {
          completed = { start: match.index, end: before.length, name: match[0] }
        }
      }
      if (!completed) return nextValue

      const info = byName.get(completed.name.toLowerCase())
      if (!info) return nextValue

      const atIndex = completed.start - 1
      const hasAtChar = atIndex >= 0 && nextValue[atIndex] === '@'
      // Email-like prefix (`foo@slack`): bail out — neither rewrite nor
      // record a context. The `@` is not a token-starting prefix.
      if (hasAtChar && !isMentionPrefixAt(nextValue, atIndex)) return nextValue
      const hasAtPrefix = hasAtChar
      // If the user already typed canonical `@Slack`, nothing to rewrite —
      // just record the context. Otherwise either insert `@` (bare name)
      // or canonicalize the casing (e.g. `@slack` → `@Slack` so the
      // mention pipeline's case-sensitive token match finds it).
      if (!hasAtPrefix || completed.name !== info.name) {
        const caret = textarea.selectionStart ?? diffIndex + 1
        const replacement = hasAtPrefix ? info.name : `@${info.name}`
        const caretShift = hasAtPrefix ? 0 : 1
        textarea.setRangeText(replacement, completed.start, completed.end, 'preserve')
        textarea.setSelectionRange(caret + caretShift, caret + caretShift)
      }

      mergeContexts([{ kind: 'integration', blockType: info.blockType, label: info.name }])
      return textarea.value
    },
    [mergeContexts]
  )

  const applyToText = useCallback(
    (text: string): string => {
      const { text: converted, contexts } = convertText(text)
      mergeContexts(contexts)
      return converted
    },
    [mergeContexts]
  )

  return { processChange, applyToText }
}
