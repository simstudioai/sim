/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { glob, grep } from '@/lib/copilot/vfs/operations'

function vfsFromEntries(entries: [string, string][]): Map<string, string> {
  return new Map(entries)
}

describe('glob', () => {
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
