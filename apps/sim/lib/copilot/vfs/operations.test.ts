/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { GlobPatternError, glob, grep } from '@/lib/copilot/vfs/operations'

function vfsFromEntries(entries: [string, string][]): Map<string, string> {
  return new Map(entries)
}

describe('glob', () => {
  it('matches nested file metadata paths with a single-star segment', () => {
    const files = vfsFromEntries([
      ['files/Reports/q1.csv/meta.json', '{}'],
      ['files/data.csv/meta.json', '{}'],
    ])
    const hits = glob(files, 'files/Reports/*/meta.json')
    expect(hits).toContain('files/Reports/q1.csv/meta.json')
    expect(hits).not.toContain('files/data.csv/meta.json')
  })

  it('matches one path segment for single star (files listing pattern)', () => {
    const files = vfsFromEntries([
      ['files/a/meta.json', '{}'],
      ['files/a/b/meta.json', '{}'],
      ['uploads/x.png', ''],
    ])
    const hits = glob(files, 'files/*/meta.json')
    expect(hits).toContain('files/a/meta.json')
    expect(hits).not.toContain('files/a/b/meta.json')
  })

  it('matches nested paths with double star', () => {
    const files = vfsFromEntries([
      ['workflows/W/state.json', ''],
      ['workflows/W/sub/state.json', ''],
    ])
    const hits = glob(files, 'workflows/**/state.json')
    expect(hits.sort()).toEqual(['workflows/W/state.json', 'workflows/W/sub/state.json'].sort())
  })

  it('includes virtual directory prefixes when pattern matches descendants', () => {
    const files = vfsFromEntries([['files/a/meta.json', '{}']])
    const hits = glob(files, 'files/**')
    expect(hits).toContain('files')
    expect(hits).toContain('files/a')
    expect(hits).toContain('files/a/meta.json')
  })

  it('treats braces literally when nobrace is set (matches old builder)', () => {
    const files = vfsFromEntries([
      ['weird{brace}/x', ''],
      ['weirdA/x', ''],
    ])
    const hits = glob(files, 'weird{brace}/*')
    expect(hits).toContain('weird{brace}/x')
    expect(hits).not.toContain('weirdA/x')
  })
})

/**
 * Matching runs on RE2, not on picomatch's own backtracking `RegExp`. These pin the glob
 * semantics that translation has to preserve, so a future change to it cannot quietly
 * widen or narrow what a pattern selects.
 */
describe('glob semantics', () => {
  it('does not let a single star cross a slash', () => {
    const files = vfsFromEntries([
      ['b.ts', ''],
      ['a/b.ts', ''],
    ])
    expect(glob(files, '*.ts')).toEqual(['b.ts'])
  })

  it('lets a double star cross slashes', () => {
    const files = vfsFromEntries([
      ['b.ts', ''],
      ['a/b.ts', ''],
      ['a/c/d.ts', ''],
    ])
    expect(glob(files, '**/*.ts').sort()).toEqual(['a/b.ts', 'a/c/d.ts', 'b.ts'])
  })

  it('matches exactly one character for a question mark, and not a slash', () => {
    const files = vfsFromEntries([
      ['abc', ''],
      ['ac', ''],
      ['a/c', ''],
    ])
    expect(glob(files, 'a?c')).toEqual(['abc'])
  })

  it('never matches a dotfile with a wildcard when dot is false', () => {
    const files = vfsFromEntries([
      ['.hidden', ''],
      ['visible', ''],
      ['a/.hidden', ''],
    ])
    expect(glob(files, '*')).toEqual(['a', 'visible'])
    expect(glob(files, '**')).toEqual(['a', 'visible'])
    expect(glob(files, 'a/*')).toEqual([])
  })

  it('still matches a dotfile when the pattern spells the dot out', () => {
    const files = vfsFromEntries([
      ['.hidden', ''],
      ['visible', ''],
    ])
    expect(glob(files, '.*')).toEqual(['.hidden'])
    expect(glob(files, '.hidden')).toEqual(['.hidden'])
  })

  it('treats extglob syntax literally when noext is set', () => {
    const files = vfsFromEntries([
      ['+(a)', ''],
      ['a', ''],
      ['aaa', ''],
    ])
    expect(glob(files, '+(a)')).toEqual(['+(a)'])
  })

  it('treats a character class as a class, and brackets in a path as literals', () => {
    const files = vfsFromEntries([
      ['ax', ''],
      ['bx', ''],
      ['cx', ''],
      ['weird[bracket]/x', ''],
    ])
    expect(glob(files, '[ab]x').sort()).toEqual(['ax', 'bx'])
    expect(glob(files, 'weird[bracket]/x')).toEqual(['weird[bracket]/x'])
  })
})

describe('glob regex safety', () => {
  it('runs a catastrophically backtracking pattern in linear time', () => {
    // `*a` twelve times then `b` is 25 characters and takes ~41s against this 48-character
    // path on picomatch's backtracking `RegExp`. Both sides are caller-supplied.
    const files = vfsFromEntries([['a'.repeat(48), '']])
    const pattern = `${'*a'.repeat(12)}b`

    const start = Date.now()
    const hits = glob(files, pattern)

    expect(hits).toEqual([])
    expect(Date.now() - start).toBeLessThan(1000)
  })

  it('still matches when the same shape has a real answer', () => {
    const files = vfsFromEntries([[`${'a'.repeat(48)}b`, '']])
    expect(glob(files, `${'*a'.repeat(12)}b`)).toEqual([`${'a'.repeat(48)}b`])
  })

  it('rejects an over-long pattern with a clear error', () => {
    const files = vfsFromEntries([['a', '']])
    expect(() => glob(files, 'a'.repeat(1001))).toThrow(GlobPatternError)
    expect(() => glob(files, 'a'.repeat(1001))).toThrow(/too long/)
  })

  it('rejects an absurd wildcard count with a clear error', () => {
    const files = vfsFromEntries([['a', '']])
    expect(() => glob(files, '*'.repeat(33))).toThrow(GlobPatternError)
    expect(() => glob(files, '*'.repeat(33))).toThrow(/too many wildcards/)
  })

  it('applies the same engine to a wildcard grep scope', () => {
    const files = vfsFromEntries([['a'.repeat(48), 'needle']])
    const pattern = `${'*a'.repeat(12)}b`

    const start = Date.now()
    const hits = grep(files, 'needle', pattern, { outputMode: 'files_with_matches' })

    expect(hits).toEqual([])
    expect(Date.now() - start).toBeLessThan(1000)
  })
})

describe('grep', () => {
  it('returns content matches per line in default mode', () => {
    const files = vfsFromEntries([['a.txt', 'hello\nworld\nhello']])
    const matches = grep(files, 'hello', undefined, { outputMode: 'content' })
    expect(matches).toHaveLength(2)
    expect(matches[0]).toMatchObject({ path: 'a.txt', line: 1, content: 'hello' })
    expect(matches[1]).toMatchObject({ path: 'a.txt', line: 3, content: 'hello' })
  })

  it('strips CR before end-of-line matching on CRLF content', () => {
    const files = vfsFromEntries([['x.txt', 'foo\r\n']])
    const matches = grep(files, 'foo$', undefined, { outputMode: 'content' })
    expect(matches).toHaveLength(1)
    expect(matches[0]?.content).toBe('foo')
  })

  it('counts matching lines', () => {
    const files = vfsFromEntries([['a.txt', 'a\nb\na']])
    const counts = grep(files, 'a', undefined, { outputMode: 'count' })
    expect(counts).toEqual([{ path: 'a.txt', count: 2 }])
  })

  it('files_with_matches scans whole file (can match across newlines with dot-all style pattern)', () => {
    const files = vfsFromEntries([['a.txt', 'foo\nbar']])
    const multiline = grep(files, 'foo[\\s\\S]*bar', undefined, {
      outputMode: 'files_with_matches',
    })
    expect(multiline).toContain('a.txt')

    const lineOnly = grep(files, 'foo[\\s\\S]*bar', undefined, { outputMode: 'content' })
    expect(lineOnly).toHaveLength(0)
  })

  it('treats trailing slash on directory scope like grep (files/ matches files/foo)', () => {
    const files = vfsFromEntries([
      ['files/TEST BOY.md/meta.json', '"name": "TEST BOY.md"'],
      ['workflows/x', 'TEST BOY'],
    ])
    const hits = grep(files, 'TEST BOY', 'files/', { outputMode: 'files_with_matches' })
    expect(hits).toContain('files/TEST BOY.md/meta.json')
    expect(hits).not.toContain('workflows/x')
  })

  it('scopes to directory prefix without matching unrelated prefixes', () => {
    const files = vfsFromEntries([
      ['workflows/a/x', 'needle'],
      ['workflowsManual/x', 'needle'],
    ])
    const hits = grep(files, 'needle', 'workflows', { outputMode: 'files_with_matches' })
    expect(hits).toContain('workflows/a/x')
    expect(hits).not.toContain('workflowsManual/x')
  })

  it('treats scope with literal brackets as directory prefix, not a glob character class', () => {
    const files = vfsFromEntries([['weird[bracket]/x.txt', 'needle']])
    const hits = grep(files, 'needle', 'weird[bracket]', { outputMode: 'files_with_matches' })
    expect(hits).toContain('weird[bracket]/x.txt')
  })

  it('scopes with glob pattern when path contains metacharacters', () => {
    const files = vfsFromEntries([
      ['workflows/A/state.json', '{"x":1}'],
      ['workflows/B/sub/state.json', '{"x":1}'],
      ['workflows/C/other.json', '{"x":1}'],
    ])
    const hits = grep(files, '1', 'workflows/*/state.json', { outputMode: 'files_with_matches' })
    expect(hits).toEqual(['workflows/A/state.json'])
  })

  it('returns empty array for invalid regex pattern', () => {
    const files = vfsFromEntries([['a.txt', 'x']])
    expect(grep(files, '(unclosed', undefined, { outputMode: 'content' })).toEqual([])
  })

  it('respects ignoreCase', () => {
    const files = vfsFromEntries([['a.txt', 'Hello']])
    const hits = grep(files, 'hello', undefined, { outputMode: 'content', ignoreCase: true })
    expect(hits).toHaveLength(1)
  })
})

describe('grep regex safety', () => {
  it('runs a catastrophic pattern in linear time', () => {
    // `a*a*b` takes minutes on a backtracking engine against this content;
    // both the pattern and the file content are caller-supplied.
    const files = vfsFromEntries([['notes.md', `${'a'.repeat(10000)}!`]])

    const start = Date.now()
    grep(files, 'a*a*b')

    expect(Date.now() - start).toBeLessThan(2000)
  })

  it('still interprets regex syntax', () => {
    const files = vfsFromEntries([['log.txt', 'req finished status=503']])
    expect(grep(files, 'status=\\d+')).toHaveLength(1)
    expect(grep(files, 'status=\\d+', undefined, { outputMode: 'count' })).toEqual([
      { path: 'log.txt', count: 1 },
    ])
  })

  it('matches syntax RE2 cannot represent literally instead of not at all', () => {
    const files = vfsFromEntries([['log.txt', 'contains (?=x) verbatim']])
    expect(grep(files, '(?=x)')).toHaveLength(1)
  })

  it('honours ignoreCase across repeated line tests', () => {
    const files = vfsFromEntries([['log.txt', 'Alpha\nALPHA\nalpha']])
    expect(grep(files, 'alpha', undefined, { ignoreCase: true })).toHaveLength(3)
    expect(grep(files, 'alpha')).toHaveLength(1)
  })
})
