import { useCallback, useMemo, useRef } from 'react'
import {
  escapeRegex,
  SKILL_CHIP_TRIGGER,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import type { SkillDefinition } from '@/hooks/queries/skills'
import type { ChatContext } from '@/stores/panel'

/**
 * Characters that signal the user has completed a word. Used by the
 * keystroke fast-path to detect that a typed skill name just ended. Mirrors
 * the integration auto-mention boundary set so the two detectors behave
 * symmetrically.
 */
const WORD_BOUNDARY_REGEX = /^[\s.,;:!?(){}[\]"'`/\\<>\n]$/

type SkillContext = Extract<ChatContext, { kind: 'skill' }>

/**
 * A skill trigger — the typed `/` or the stored EM SPACE sentinel — only counts
 * when it itself starts a token (position 0 or after whitespace). This prevents
 * path-like patterns (`foo/bar`) from chipping as `/bar`, and lets a pasted or
 * restored `<sentinel>name` token re-chip just like a freshly typed `/name`.
 */
function isTriggerPrefixAt(text: string, index: number): boolean {
  const ch = text[index]
  if (ch !== '/' && ch !== SKILL_CHIP_TRIGGER) return false
  if (index === 0) return true
  return /\s/.test(text[index - 1])
}

interface UseSkillAutoMentionProps {
  /** Skills available in the current workspace. */
  skills: SkillDefinition[]
  /** Setter for the host's selected contexts. */
  setSelectedContexts: React.Dispatch<React.SetStateAction<ChatContext[]>>
}

interface ProcessChangeArgs {
  textarea: HTMLTextAreaElement
  previousValue: string
  nextValue: string
}

/**
 * Auto-registers skill contexts when a typed `/skill-name` is completed.
 *
 * The user types `/skill-name`, but the displayed token stores an EM SPACE
 * sentinel (`SKILL_CHIP_TRIGGER`) in place of the narrow `/` so the centered
 * chip icon fits its overlay slot like `@` does. Both entry points accept
 * either trigger — a freshly typed `/` or a pasted/restored sentinel — swap a
 * typed `/` for the sentinel, and share one dedup-by-skillId helper:
 * - `processChange`: keystroke fast-path. When a word-boundary char completes
 *   a `/name` token whose name matches a known skill, the leading `/` is
 *   swapped for the sentinel (caret preserved) and the skill context is
 *   registered.
 * - `applyToText`: bulk path for paste, template insertion, draft restore, and
 *   speech-to-text. Swaps each matched typed `/` for the sentinel in the
 *   returned string and registers any matched skill contexts.
 */
export function useSkillAutoMention({ skills, setSelectedContexts }: UseSkillAutoMentionProps) {
  /**
   * Matcher built from skill names, longest-first so `/my-skill-extended`
   * wins over `/my-skill`. The trailing guard rejects partial matches that
   * continue into more name characters.
   */
  const matcher = useMemo(() => {
    const byName = new Map<string, SkillContext>()
    for (const skill of skills) {
      byName.set(skill.name.toLowerCase(), {
        kind: 'skill',
        skillId: skill.id,
        label: skill.name,
      })
    }
    const names = [...skills].map((s) => s.name).sort((a, b) => b.length - a.length)
    if (names.length === 0) return { regex: null as RegExp | null, byName }
    // Match either trigger: the typed '/' or the stored sentinel, so both fresh
    // input and pasted/restored chips resolve. The trigger group is the match's
    // first char (`text[match.index]`); group 1 is the skill name.
    const trigger = `(?:/|${escapeRegex(SKILL_CHIP_TRIGGER)})`
    const pattern = `${trigger}(${names.map(escapeRegex).join('|')})(?![A-Za-z0-9_-])`
    return { regex: new RegExp(pattern, 'gi'), byName }
  }, [skills])

  const matcherRef = useRef(matcher)
  matcherRef.current = matcher

  const mergeContexts = useCallback(
    (additions: SkillContext[]) => {
      if (additions.length === 0) return
      setSelectedContexts((prev) => {
        const existing = new Set(
          prev.filter((c): c is SkillContext => c.kind === 'skill').map((c) => c.skillId)
        )
        const fresh = additions.filter((c) => !existing.has(c.skillId))
        return fresh.length > 0 ? [...prev, ...fresh] : prev
      })
    },
    [setSelectedContexts]
  )

  const processChange = useCallback(
    ({ textarea, previousValue, nextValue }: ProcessChangeArgs): string => {
      if (nextValue.length !== previousValue.length + 1) return nextValue
      const { regex, byName } = matcherRef.current
      if (!regex) return nextValue

      let diffIndex = 0
      while (
        diffIndex < previousValue.length &&
        previousValue[diffIndex] === nextValue[diffIndex]
      ) {
        diffIndex++
      }

      const inserted = nextValue[diffIndex]
      if (!inserted || !WORD_BOUNDARY_REGEX.test(inserted)) return nextValue

      const before = nextValue.slice(0, diffIndex)
      regex.lastIndex = 0
      let completed: { start: number; name: string } | null = null
      let match: RegExpExecArray | null
      while ((match = regex.exec(before)) !== null) {
        if (match.index + match[0].length === before.length) {
          completed = { start: match.index, name: match[1] }
        }
      }
      if (!completed) return nextValue
      if (!isTriggerPrefixAt(nextValue, completed.start)) return nextValue

      const context = byName.get(completed.name.toLowerCase())
      if (!context) return nextValue

      mergeContexts([context])

      // A typed '/' becomes the wide sentinel so the centered chip icon fits its
      // overlay slot; a sentinel that's already there (e.g. just-pasted) is left
      // as-is. `setRangeText` with 'preserve' keeps the caret and folds into the
      // keystroke's native undo step; the returned value mirrors the rewrite so
      // the controlled state updates too.
      if (nextValue[completed.start] !== '/') return nextValue
      textarea.setRangeText(SKILL_CHIP_TRIGGER, completed.start, completed.start + 1, 'preserve')
      return textarea.value
    },
    [matcherRef, mergeContexts]
  )

  const applyToText = useCallback(
    (text: string): string => {
      const { regex, byName } = matcherRef.current
      if (!regex || !text) return text

      regex.lastIndex = 0
      const additions: SkillContext[] = []
      const seen = new Set<string>()
      const slashIndices: number[] = []
      let match: RegExpExecArray | null
      while ((match = regex.exec(text)) !== null) {
        const index = match.index
        if (!isTriggerPrefixAt(text, index)) continue
        const context = byName.get(match[1].toLowerCase())
        if (!context) continue
        // Rewrite every confirmed typed '/' (even a repeated skill) so duplicate
        // tokens chip consistently; tokens already on the sentinel need no edit.
        if (text[index] === '/') slashIndices.push(index)
        if (seen.has(context.skillId)) continue
        seen.add(context.skillId)
        additions.push(context)
      }
      mergeContexts(additions)

      if (slashIndices.length === 0) return text
      // Replace each matched '/' with the wide sentinel so paste, draft, and STT
      // paths chip correctly. Splice by UTF-16 index (the regex's index space)
      // descending so earlier replacements don't shift later indices; the
      // sentinel is one code unit wide like '/'.
      let result = text
      for (const idx of [...slashIndices].sort((a, b) => b - a)) {
        result = result.slice(0, idx) + SKILL_CHIP_TRIGGER + result.slice(idx + 1)
      }
      return result
    },
    [matcherRef, mergeContexts]
  )

  return { processChange, applyToText }
}
