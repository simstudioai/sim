/**
 * @vitest-environment node
 */
import micromatch from 'micromatch'
import { describe, expect, it } from 'vitest'
import { compileGlobMatcher, VFS_GLOB_OPTIONS } from '@/lib/copilot/vfs/operations'

/**
 * Differential test: {@link compileGlobMatcher} runs micromatch's own compiled pattern on
 * RE2, so its answer must be micromatch's answer for every pattern and every path. This
 * generates the pattern grid from glob atoms rather than listing cases, because the parts
 * that are easy to get wrong are the combinations — a star next to a globstar, a dot
 * segment under a wildcard, a class at a segment start.
 *
 * A pattern the translation cannot represent compiles to `null` and matches nothing. That
 * is the deliberate fail-closed path, so those patterns are counted rather than compared.
 * They are all degenerate shapes (unbalanced parens, a POSIX class behind a star); the
 * patterns anyone would actually type are pinned separately by {@link REALISTIC}.
 */
const GLOB_OPTIONS = VFS_GLOB_OPTIONS

/** An astral character, and the two lone surrogates it decomposes into. */
const ASTRAL = '\u{1F600}'
const HIGH_SURROGATE = '\uD83D'
const LOW_SURROGATE = '\uDE00'

/**
 * Atoms for the exhaustive grid. Negated classes and parentheses are included because
 * picomatch treats `[^…]` and `(` specially even under `noext`, and neither goes through
 * the `(?!\.)` guard that the rest of the translation keys on. `|` is included because a
 * marker slot opened inside one branch of a group is not the one the next branch or the
 * position after the group needs. The astral and lone-surrogate atoms are included because
 * picomatch counts UTF-16 code units and RE2 counts code points, so every `?` and `[^…]`
 * next to one is a place the two engines can disagree.
 */
const ATOMS = [
  'a',
  '.',
  '..',
  'x',
  '*',
  '**',
  '?',
  '/',
  '.git',
  '[abc]',
  '[.]',
  '[!a]',
  '{b,c}',
  '+(z)',
  '.a',
  'a.',
  '\\.',
  '\\*',
  'b',
  '[^a]',
  '[^a-z]',
  '[^0-9-]',
  '[^[:alpha:]]',
  '(',
  ')',
  '|',
  ASTRAL,
  HIGH_SURROGATE,
  LOW_SURROGATE,
] as const

/**
 * Atoms for a deeper walk. Four of these compose the shapes a three-atom walk cannot reach
 * at all: globstar, slash, dot and star together are the dotfile pattern that returned nothing.
 */
const DEEP_ATOMS = [
  '*',
  '**',
  '/',
  '/**',
  '.',
  '.*',
  './',
  'a',
  '.ts',
  'rc',
  '[^a]',
  '(',
  ')',
  '|',
  ASTRAL,
] as const

const PATHS = [
  'a',
  'a/b',
  'a/b.ts',
  'b.ts',
  'a/b/c.ts',
  '.hidden',
  'a/.hidden',
  '.hidden/x',
  'files',
  'files/a',
  'files/a/meta.json',
  'files/Reports/q1.csv/meta.json',
  'weird{brace}/x',
  'weird[bracket]/x',
  'a.b',
  '/',
  'a/',
  '/a',
  'a//b',
  '.',
  '..',
  'a/./b',
  'a/..',
  'x',
  'xy',
  'abc',
  'a?c',
  '+(a)',
  '*',
  'node_modules/x',
  '.a/.b',
  'a/b/.c/d',
  'a\nb',
  'a/b\nc',
  'a.',
  '..a',
  'a b/c',
  'a*b',
  'a\\b',
  '.git',
  '.git/config',
  'a/.git/b',
  'A/B',
  'a/b/c/d/e',
  'ab',
  'ba',
  '..hidden',
  'a/.b.ts',
  '.b.ts',
  'a.b.c',
  'x..y',
  'a.b.',
  'a/b/',
  'x/',
  'a/x.ts',
  'a.ts',
  '.x',
  'x.',
  'a/.',
  './a',
  'x.y',
  'a/.b',
  '[abc]',
  '-x',
  ']x',
  '.a',
  'a/.a',
  'z',
  '..a/b',
  '.git/.x',
  'a.git',
  '{b,c}',
  '+(z)',
  '.gitignore',
  'a/b/.',
  'b/..',
  '',
  '\\u2028b',
  '\na$',
  '.\n',
  '.é}()',
  '\\u2029x',
  'a/\nb',
  'a/\\u2028',
  '.env',
  'app/.env.local',
  'src/.eslintrc',
  'src/index.ts',
  ASTRAL,
  `${ASTRAL}.png`,
  `a${ASTRAL}`,
  `${ASTRAL}${ASTRAL}`,
  `.${ASTRAL}`,
  `${ASTRAL}/a`,
  `a/${ASTRAL}`,
  HIGH_SURROGATE,
  LOW_SURROGATE,
  `${LOW_SURROGATE}${HIGH_SURROGATE}`,
  `${HIGH_SURROGATE}.ts`,
  `.${HIGH_SURROGATE}`,
  'a|b',
] as const

/** Patterns a caller would plausibly type; none of these may fail closed. */
const REALISTIC = [
  '**/*.ts',
  'src/**',
  '*.{ts,tsx}',
  '**/test_*.py',
  'docs/**/*.md',
  '.env',
  '.github/**',
  '**/.env',
  '**/.gitignore',
  '.*',
  'a b/*.md',
  '**/[Rr]eadme*',
  'files/*/meta.json',
  '**/.*',
  '**/.*.ts',
  './**/.*',
  '**/.*rc',
  '.*/**',
  '**/.*/**',
  'uploads/*',
  '**',
] as const

function buildPatterns(): string[] {
  const patterns = new Set<string>()
  const walk = (atoms: readonly string[], remaining: number, current: string) => {
    if (current) patterns.add(current)
    if (remaining === 0) return
    for (const atom of atoms) walk(atoms, remaining - 1, current + atom)
  }
  walk(ATOMS, 3, '')
  walk(DEEP_ATOMS, 4, '')
  return Array.from(patterns)
}

function expectAgreement(pattern: string, path: string) {
  const matcher = compileGlobMatcher(pattern)
  const expected = micromatch.isMatch(path, pattern, GLOB_OPTIONS)
  expect(matcher?.matches(path) ?? false, `pattern=${pattern} path=${JSON.stringify(path)}`).toBe(
    expected
  )
}

describe('glob matcher equivalence with micromatch', () => {
  it('agrees with micromatch.isMatch across the full pattern grid', () => {
    const patterns = buildPatterns()
    const mismatches: string[] = []
    let unrepresentable = 0
    let compared = 0

    for (const pattern of patterns) {
      const matcher = compileGlobMatcher(pattern)
      if (!matcher) {
        unrepresentable++
        continue
      }
      for (const path of PATHS) {
        const expected = micromatch.isMatch(path, pattern, GLOB_OPTIONS)
        const actual = matcher.matches(path)
        compared++
        if (expected !== actual && mismatches.length < 20) {
          mismatches.push(
            `pattern=${JSON.stringify(pattern)} path=${JSON.stringify(path)} micromatch=${expected} re2=${actual}`
          )
        }
      }
    }

    expect(mismatches).toEqual([])
    expect(compared).toBeGreaterThan(6_000_000)
    expect(unrepresentable / patterns.length).toBeLessThan(0.08)
  }, 120_000)

  it('covers the shapes the translation keys on', () => {
    const patterns = new Set(buildPatterns())
    for (const pattern of ['**/.*', '**/.*.ts', './**/.*', '**/.*rc', '.*/**', '**/.*/**']) {
      expect(patterns.has(pattern), pattern).toBe(true)
    }
    expect(Array.from(patterns).some((p) => p.includes('[^'))).toBe(true)
    expect(Array.from(patterns).some((p) => p.includes('('))).toBe(true)
  })

  it('represents every realistic pattern rather than failing closed', () => {
    for (const pattern of REALISTIC) {
      expect(compileGlobMatcher(pattern), pattern).not.toBeNull()
    }
  })

  it('matches dotfiles at every depth under a globstar', () => {
    const matcher = compileGlobMatcher('**/.*')
    expect(matcher).not.toBeNull()
    for (const path of ['.env', '.gitignore', 'app/.env.local', 'src/.eslintrc']) {
      expect(matcher?.matches(path), path).toBe(true)
    }
    for (const path of ['src/index.ts', 'README.md']) {
      expect(matcher?.matches(path), path).toBe(false)
    }
  })

  it('keeps the dot guard off classes picomatch never guarded', () => {
    for (const pattern of ['[^a]x', '[^a-z]x', '[^0-9-]x', '[^[:alpha:]]x', '(*)']) {
      expectAgreement(pattern, '.x')
    }
    expectAgreement('[^a]*', '.é}()')
  })

  it('keeps the non-empty assertion when the tail rewrite does not fire', () => {
    expectAgreement('*.', '\na$...')
    expectAgreement('*?', '\\u2028b\\é')
  })

  it('counts UTF-16 code units the way picomatch does, not code points', () => {
    // `?` compiles to `[^/]`, which picomatch runs without the `u` flag, so it consumes one
    // code unit and an astral character does not match it. RE2 counts code points, which
    // silently widened `?` and `[^…]` into astral filenames — files a scope should exclude.
    for (const [pattern, path] of [
      ['?', ASTRAL],
      ['?.png', `${ASTRAL}.png`],
      ['[^a]', ASTRAL],
      ['??', ASTRAL],
      ['?', HIGH_SURROGATE],
      ['*', ASTRAL],
      ['??b', `${ASTRAL}b`],
      [`${ASTRAL}.png`, `${ASTRAL}.png`],
      ['**/?', `a/${ASTRAL}`],
      ['.?', `.${ASTRAL}`],
    ] as const) {
      expectAgreement(pattern, path)
    }
    expect(compileGlobMatcher('?')?.matches(ASTRAL)).toBe(false)
    expect(compileGlobMatcher('??')?.matches(ASTRAL)).toBe(true)
  })

  it('reopens the marker slot a group would otherwise trap', () => {
    // A slot opened inside a group is unreachable once the group matches nothing, so the
    // segment marker stayed unconsumable and no dot path could ever match.
    for (const pattern of ['(a|b)?*', '(a|)*', '((a|b)|(c|d))?*', '**|*']) {
      for (const path of ['.hidden', '.', '..', '.env', 'ab', 'a']) {
        expectAgreement(pattern, path)
      }
    }
    expect(compileGlobMatcher('(a|b)?*')?.matches('.hidden')).toBe(true)
  })

  it('rejects the empty path the way micromatch does', () => {
    for (const pattern of ['**', '**/**', '**/', '**/**/**', '\\']) {
      expectAgreement(pattern, '')
    }
  })
})
