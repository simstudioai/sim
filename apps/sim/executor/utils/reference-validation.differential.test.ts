/**
 * @vitest-environment node
 *
 * Differential test: narrowing the `{{ENV_VAR}}` body from `[^}]` to `[^{}]`
 * must not change resolution for any name the product can represent.
 *
 * The narrowing exists to remove polynomial backtracking — a class admitting
 * its own opening delimiter lets every offset in a run of `{` restart a full
 * scan. That is a real change to the accepted language, not a refactor, and it
 * runs on the execution path, so the divergence is pinned down here rather than
 * argued in a review comment.
 *
 * The one accepted divergence is enumerated below: a reference whose name
 * contains `{`. `PATTERNS.ENV_VAR_NAME` forbids that character, so no such name
 * can be stored through the secrets manager, and the divergence is unreachable.
 */

import { describe, expect, it } from 'vitest'
import { PATTERNS, REFERENCE } from '@/executor/constants'
import { createEnvVarPattern, resolveEnvVarReferences } from '@/executor/utils/reference-validation'

/** The pattern as it stood before the narrowing. */
function createLegacyEnvVarPattern(): RegExp {
  return new RegExp(`\\${REFERENCE.ENV_VAR_START}([^}]+)\\${REFERENCE.ENV_VAR_END}`, 'g')
}

function matchesOf(pattern: RegExp, text: string): string[] {
  pattern.lastIndex = 0
  const found: string[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) found.push(`${match.index}:${match[0]}`)
  return found
}

/**
 * Complete up to character equivalence: `{`, `}`, `<`, `>` are the delimiters,
 * and every other character behaves identically in both bodies. `_`, `A` and
 * the space cover the name, trim and separator cases.
 */
const ALPHABET = ['{', '}', '<', '>', 'A', '_', ' ']
const MAX_LEN = 6

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

/** The enumerated divergence: a `{{` whose body reaches a `{` before any `}`. */
const NAME_CONTAINS_BRACE = /\{\{[^}]*\{/

describe('env var pattern narrowing', () => {
  it('diverges only where the reference name contains an opening brace', () => {
    const legacy = createLegacyEnvVarPattern()
    const current = createEnvVarPattern()
    const unexplained: string[] = []
    let differed = 0

    for (const text of corpus()) {
      const before = matchesOf(legacy, text)
      const after = matchesOf(current, text)
      if (before.join('|') === after.join('|')) continue
      differed++
      if (!NAME_CONTAINS_BRACE.test(text) && unexplained.length < 20) unexplained.push(text)
    }

    expect(unexplained).toEqual([])
    expect(differed).toBeGreaterThan(0)
  })

  it('never diverges on a representable environment-variable name', () => {
    const legacy = createLegacyEnvVarPattern()
    const current = createEnvVarPattern()
    const names = ['A', '_', 'API_KEY', 'a1', '_x9', 'X'.repeat(64)]
    const surroundings = ['%s', 'a%sb', '%s%s', 'x {{%s}} y', '{{%s}} {{%s}}']

    for (const name of names) {
      expect(PATTERNS.ENV_VAR_NAME.test(name)).toBe(true)
      for (const shape of surroundings) {
        const text = shape.replaceAll('%s', `{{${name}}}`).replaceAll('{{{{', '{{')
        expect(matchesOf(current, text)).toEqual(matchesOf(legacy, text))
      }
    }
  })

  it('still resolves references, including padded and embedded ones', () => {
    const envVars = { API_KEY: 'secret', OTHER: 'value' }
    expect(resolveEnvVarReferences('{{API_KEY}}', envVars)).toBe('secret')
    expect(resolveEnvVarReferences('{{ API_KEY }}', envVars)).toBe('secret')
    expect(resolveEnvVarReferences('a-{{API_KEY}}-b', envVars)).toBe('a-secret-b')
    expect(resolveEnvVarReferences('{{API_KEY}}/{{OTHER}}', envVars)).toBe('secret/value')
  })

  it('scans an unterminated brace run in linear time', () => {
    const started = performance.now()
    resolveEnvVarReferences('{'.repeat(100_000), { API_KEY: 'secret' })
    expect(performance.now() - started).toBeLessThan(1_000)
  })
})
