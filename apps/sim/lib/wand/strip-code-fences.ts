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
 * Only the outermost delimiters are removed: everything between the first and
 * last fence line is kept verbatim, including any fence lines inside it. A
 * generated body may legitimately contain line-leading backticks (code that
 * builds a markdown string), and pairing delimiters off would silently discard
 * the lines between them. The cost is that a model which answers with several
 * fenced blocks and prose between them keeps that prose — visibly wrong output
 * the user can re-roll, rather than code quietly missing a chunk.
 *
 * Falls back to the original text if stripping would leave nothing.
 */
export function stripCodeFences(text: string): string {
  const lines = text.split('\n')
  const openingFence = lines.findIndex((line) => FENCE_LINE.test(line))
  if (openingFence === -1) return text

  // Anything non-blank ahead of the first fence means the response does not open
  // with one, so the backticks belong to the content.
  for (let index = 0; index < openingFence; index++) {
    if (lines[index].trim() !== '') return text
  }

  let closingFence = -1
  for (let index = lines.length - 1; index > openingFence; index--) {
    if (FENCE_LINE.test(lines[index])) {
      closingFence = index
      break
    }
  }

  // An unclosed fence (a truncated response) keeps everything after the opener.
  const inner =
    closingFence === -1
      ? lines.slice(openingFence + 1)
      : lines.slice(openingFence + 1, closingFence)

  // Trim blank lines only — leading whitespace on a kept line is indentation,
  // which is load-bearing in Python.
  while (inner.length > 0 && inner[0].trim() === '') inner.shift()
  while (inner.length > 0 && inner[inner.length - 1].trim() === '') inner.pop()

  return inner.length > 0 ? inner.join('\n') : text
}
