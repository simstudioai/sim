/**
 * @vitest-environment node
 *
 * Differential test: the placeholder scan must accept exactly what the regex it
 * replaced accepted.
 *
 * `collectCodePlaceholderOccurrences` used `/\{\{([^}]+)\}\}/g`, which is quadratic
 * because the body class admits `{`. Narrowing the class would have been the cheap
 * fix, but parameter keys are arbitrary strings — they bind to opaque indexed names,
 * not to identifiers — so a name containing `{` is representable and dropping it
 * would silently leave a literal placeholder in compiled user code.
 *
 * The scan therefore keeps the old language and drops only the backtracking. That is
 * only safe if it is exactly equivalent, so the equivalence is pinned here rather
 * than argued: any divergence from the regex is a bug, with no exceptions enumerated.
 */

import { describe, expect, it } from 'vitest'
import { collectCodePlaceholderOccurrences } from '@/lib/execution/code-placeholders/shared'
import type { CodePlaceholderOccurrence } from '@/lib/execution/code-placeholders/types'

/** The regex the scan replaced, applied with the same skip-blank-name rule. */
function collectWithLegacyRegex(code: string): CodePlaceholderOccurrence[] {
  const pattern = /\{\{([^}]+)\}\}/g
  const occurrences: CodePlaceholderOccurrence[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(code)) !== null) {
    const name = match[1].trim()
    if (!name) continue
    occurrences.push({
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0],
      name,
    })
  }
  return occurrences
}

/**
 * Complete up to character equivalence: `{` and `}` are the delimiters and every
 * other character behaves identically in the body. `A` and the space cover the
 * name and the trim-to-blank case.
 */
const ALPHABET = ['{', '}', 'A', ' ']
const MAX_LEN = 12

function* corpus(): Generator<string> {
  let level = ['']
  yield ''
  for (let length = 1; length <= MAX_LEN; length++) {
    const next: string[] = []
    for (const prefix of level) {
      for (const character of ALPHABET) {
        const candidate = prefix + character
        next.push(candidate)
        yield candidate
      }
    }
    level = next
  }
}

describe('code placeholder scan', () => {
  it('is exactly equivalent to the regex it replaced', () => {
    let compared = 0
    const divergent: string[] = []

    for (const code of corpus()) {
      compared++
      const scanned = JSON.stringify(collectCodePlaceholderOccurrences(code))
      const expected = JSON.stringify(collectWithLegacyRegex(code))
      if (scanned !== expected && divergent.length < 20) divergent.push(code)
    }

    expect(divergent).toEqual([])
    expect(compared).toBeGreaterThan(20_000_000)
  }, 900_000)

  it('keeps names that contain an opening brace', () => {
    expect(collectCodePlaceholderOccurrences('{{a{b}}').map((o) => o.name)).toEqual(['a{b'])
    expect(collectCodePlaceholderOccurrences('x {{ A }} y').map((o) => o.name)).toEqual(['A'])
  })

  it('scans an unterminated brace run in linear time', () => {
    const started = performance.now()
    collectCodePlaceholderOccurrences('{'.repeat(200_000))
    expect(performance.now() - started).toBeLessThan(1_000)
  })
})
