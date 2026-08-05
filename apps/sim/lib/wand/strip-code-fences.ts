import type { GenerationType } from '@/blocks/types'

/** A markdown fence delimiter at the start of a line, ignoring indentation. */
const FENCE_LINE = /^\s*```/

/**
 * Whether a wand generation's output is a raw machine value, where a leading
 * markdown fence is always wrong and must be removed.
 *
 * Declared as a total `Record` so adding a `GenerationType` fails the build
 * until the new type opts in or out deliberately — a silent default would let a
 * prose type start stripping fences (or a code type stop) without review.
 *
 * `system-prompt` is the sole exclusion: it is free-form prose for a model, so a
 * fenced example inside it is legitimate authored content, not a formatting slip.
 */
const STRIPS_CODE_FENCES: Record<GenerationType, boolean> = {
  'javascript-function-body': true,
  'typescript-function-body': true,
  'json-schema': true,
  'json-object': true,
  'table-schema': true,
  'system-prompt': false,
  'custom-tool-schema': true,
  'sql-query': true,
  postgrest: true,
  'mongodb-filter': true,
  'mongodb-pipeline': true,
  'mongodb-sort': true,
  'mongodb-documents': true,
  'mongodb-update': true,
  'neo4j-cypher': true,
  'neo4j-parameters': true,
  timestamp: true,
  timezone: true,
  'cron-expression': true,
  'odata-expression': true,
}

/**
 * Whether generated content for this type should have markdown fences stripped.
 *
 * An absent type means the field's `wandConfig` never declared one, which is the
 * case for free-form prose fields — those are left untouched.
 */
export function shouldStripCodeFences(generationType?: string): boolean {
  if (!generationType) return false
  return STRIPS_CODE_FENCES[generationType as GenerationType] === true
}

/**
 * Removes the markdown code fences a model wrapped around a raw value.
 *
 * Applies only when the response *opens* with a fence. Content that merely
 * contains a fence later is left untouched, because a backtick run inside a
 * template literal or a docstring is valid code that must survive verbatim —
 * a false positive here would corrupt working code, which is far worse than
 * leaving a rare unwrapped response for the user to fix.
 *
 * Within a fenced response every fenced region is kept and everything between
 * them is dropped: text outside a fence is prose, which is never valid code.
 * Falls back to the original text if stripping would leave nothing.
 */
export function stripCodeFences(text: string): string {
  if (!text.trimStart().startsWith('```')) return text

  const collected: string[] = []
  let insideFence = false

  for (const line of text.split('\n')) {
    if (FENCE_LINE.test(line)) {
      insideFence = !insideFence
      continue
    }
    if (insideFence) collected.push(line)
  }

  // Trim blank lines only — leading whitespace on a kept line is indentation,
  // which is load-bearing in Python.
  while (collected.length > 0 && collected[0].trim() === '') collected.shift()
  while (collected.length > 0 && collected[collected.length - 1].trim() === '') collected.pop()

  return collected.length > 0 ? collected.join('\n') : text
}
