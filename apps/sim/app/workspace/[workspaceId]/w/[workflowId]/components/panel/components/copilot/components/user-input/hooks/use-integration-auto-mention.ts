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
 * Scans `text` for explicit `@`-prefixed integration mentions and
 * canonicalizes their casing (`@slack` → `@Slack`). Bare integration names
 * are left untouched — plain words like `Monday` or `Notion` in prose must
 * never be rewritten or chipped (the scunthorpe problem); only a deliberate
 * `@` opt-in gets mention treatment.
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
    // Only explicit, token-starting `@` mentions count. Bare names and
    // email-like prefixes (`foo@slack`) are skipped entirely.
    if (!isMentionPrefixAt(text, match.index - 1)) continue
    if (!seen.has(info.name)) {
      seen.add(info.name)
      contexts.push({ kind: 'integration', blockType: info.blockType, label: info.name })
    }
    // Skip rewrite when the match is already in canonical `@Slack` form;
    // otherwise canonicalize the casing.
    if (match[0] === info.name) continue
    result += text.slice(lastEnd, match.index) + info.name
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
 * Canonicalizes explicit `@`-prefixed integration mentions (`@slack`,
 * `@aws textract`, any casing) into `@CanonicalName` form so they render
 * with the exact same chip UI as resource mentions — preserving caret
 * alignment, undo grouping, and copy/paste round-tripping. Bare integration
 * names in prose are deliberately left untouched: mention treatment is
 * strictly opt-in via `@`.
 *
 * Two entry points share one dedup helper:
 * - `processChange`: keystroke fast-path. Detects a typed word-boundary
 *   char that just completed an `@`-prefixed integration name and rewrites
 *   the textarea in a single `setRangeText` edit (joined with the typed
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
        const existing = new Set<string>()
        for (const c of prev) {
          if (c.kind === 'integration') existing.add(c.label)
        }
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

      // Only explicit, token-starting `@` mentions count. Bare names and
      // email-like prefixes (`foo@slack`) are left untouched — a plain word
      // like `Monday` in prose must never be rewritten or chipped.
      if (!isMentionPrefixAt(nextValue, completed.start - 1)) return nextValue
      // If the user already typed canonical `@Slack`, nothing to rewrite —
      // just record the context. Otherwise canonicalize the casing
      // (e.g. `@slack` → `@Slack` so the mention pipeline's case-sensitive
      // token match finds it).
      if (completed.name !== info.name) {
        const caret = textarea.selectionStart ?? diffIndex + 1
        textarea.setRangeText(info.name, completed.start, completed.end, 'preserve')
        textarea.setSelectionRange(caret, caret)
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
