/**
 * @vitest-environment node
 */
import micromatch from 'micromatch'
import { describe, expect, it } from 'vitest'
import {
  compileGlobMatcher,
  glob,
  pathWithinGrepScope,
  VFS_GLOB_OPTIONS,
} from '@/lib/copilot/vfs/operations'

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

/** A class range wide enough to bracket the private-use markers the translation reserves. */
const WIDE_CLASS = '[\u{2000}-\u{F000}]'

/**
 * Atoms for the exhaustive grid. Negated classes and parentheses are included because
 * picomatch treats `[^…]` and `(` specially even under `noext`, and neither goes through
 * the `(?!\.)` guard that the rest of the translation keys on. `|` is included because a
 * marker slot opened inside one branch of a group is not the one the next branch or the
 * position after the group needs. The astral and lone-surrogate atoms are included because
 * picomatch counts UTF-16 code units and RE2 counts code points, so every `?` and `[^…]`
 * next to one is a place the two engines can disagree. The escape atoms and the wide class
 * range are included because picomatch passes a caller's `\X` and `[x-y]` through verbatim and
 * RE2 reads several of those differently than ECMAScript does, and `!` because it is the one
 * glob feature whose compiled shape is a lookahead.
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
  '!',
  '\\a',
  '\\A',
  '\\p{L}',
  WIDE_CLASS,
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

/**
 * Atoms RE2 cannot be handed at all: it reads `\A` and `\z` as anchors, `\a` as BEL, `\p{…}`
 * as a Unicode class, and a range spanning the private-use block would consume a segment
 * marker. They are compared like every other pattern but held out of the unrepresentable
 * ratio, which measures how often a pattern someone might type is refused.
 */
const REFUSED_ATOMS = ['\\a', '\\A', '\\p{L}', WIDE_CLASS] as const

function containsRefusedAtom(pattern: string): boolean {
  return REFUSED_ATOMS.some((atom) => pattern.includes(atom))
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
    let translatable = 0
    let compared = 0

    for (const pattern of patterns) {
      const matcher = compileGlobMatcher(pattern)
      const held = containsRefusedAtom(pattern)
      if (!held) translatable++
      if (!matcher) {
        if (!held) unrepresentable++
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
    expect(unrepresentable / translatable).toBeLessThan(0.08)
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

  it('refuses the escape alphabet picomatch never emits', () => {
    // picomatch escapes only punctuation, so `\A`, `\z`, `\a` and `\p{…}` are caller text it
    // passes through. RE2 reads them as anchors, BEL and a Unicode class — and `\p{Any}`
    // consumes the segment markers, taking `dot: false` with it.
    for (const [pattern, path] of [
      ['\\A**/**', 'secrets/prod.key'],
      ['\\A**/**', 'README.md'],
      ['\\p{Any}**/**', '.git/config'],
      ['*\\z', 'README.md'],
      ['[^\\a]', 'a'],
    ] as const) {
      expectAgreement(pattern, path)
    }
    // `[\a-z]` is the fail-safe half of the same rule: ECMAScript reads `\a` as a literal `a`
    // and matches, and refusing costs a match rather than granting one.
    expect(compileGlobMatcher('[\\a-z]')).toBeNull()
    expect(compileGlobMatcher('\\A**/**')).toBeNull()
    expect(pathWithinGrepScope('secrets/prod.key', '\\A**/**')).toBe(false)
  })

  it('refuses a class range spanning the reserved code points', () => {
    // The range brackets the segment markers and the surrogate escape block, so the class
    // consumes a marker where micromatch requires a real character and every later atom
    // matches one position to the left.
    for (const [pattern, path] of [
      [`${WIDE_CLASS}.env`, '.env'],
      [`${WIDE_CLASS}*`, '.env'],
      [`${WIDE_CLASS}.git/config`, '.git/config'],
      [`${WIDE_CLASS}..`, '..'],
      [`[^a${WIDE_CLASS.slice(1)}`, '.env'],
    ] as const) {
      expectAgreement(pattern, path)
    }
    // A pair of such classes spans both halves of a remapped astral character, which is the
    // fail-safe half of the rule: micromatch matches it and refusing costs that match.
    expect(compileGlobMatcher(`${WIDE_CLASS}${WIDE_CLASS}`)).toBeNull()
    expect(compileGlobMatcher(`${WIDE_CLASS}.env`)).toBeNull()
    expect(pathWithinGrepScope('.env', `${WIDE_CLASS}*`)).toBe(false)
  })

  it('matches negated patterns instead of silently matching nothing', () => {
    const files = new Map([
      ['a.ts', ''],
      ['b.js', ''],
    ])
    expect(glob(files, '!*.ts')).toEqual(['b.js'])
    for (const pattern of ['!*.ts', '!.env', '!**/*.md', '!a', '!', '!!a', '!!*.ts', '!(a)']) {
      for (const path of PATHS) {
        expectAgreement(pattern, path)
      }
    }
  })

  it('refuses a zero-padded repeat bound RE2 reads as literal text', () => {
    for (const pattern of ['a{00}b', 'a{00,2}b', '.{00,}*', 'a{1,02}b']) {
      expect(compileGlobMatcher(pattern), pattern).toBeNull()
    }
    expect(compileGlobMatcher('a{0,2}b'), 'a{0,2}b').not.toBeNull()
  })

  it('rejects the empty path the way micromatch does', () => {
    for (const pattern of ['**', '**/**', '**/', '**/**/**', '\\']) {
      expectAgreement(pattern, '')
    }
  })
})
