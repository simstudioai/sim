/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  glob,
  grep,
  grepReadResult,
  pathWithinGrepScope,
  WorkspaceFileGrepError,
} from '@/lib/copilot/vfs/operations'
import { readPlaceholder } from '@/lib/copilot/vfs/read-placeholders'

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

  it('expands brace alternatives across path segments', () => {
    const files = vfsFromEntries([
      ['workflows/Elder/state.json', '{}'],
      ['workflows/Utils/state.json', '{}'],
      ['workflows/Other/state.json', '{}'],
    ])
    const hits = glob(files, 'workflows/{Elder,Utils}/state.json')
    expect(hits.sort()).toEqual(['workflows/Elder/state.json', 'workflows/Utils/state.json'])
  })

  it('expands extension braces', () => {
    const files = vfsFromEntries([
      ['files/a.png', ''],
      ['files/b.md', ''],
      ['files/c.txt', ''],
    ])
    const hits = glob(files, 'files/*.{png,md}')
    expect(hits.sort()).toEqual(['files/a.png', 'files/b.md'])
  })

  it('expands braces in decoded-form patterns against encoded keys', () => {
    const files = vfsFromEntries([
      ['workflows/Elder%20v1/state.json', '{}'],
      ['workflows/Elder%20v2/state.json', '{}'],
    ])
    const hits = glob(files, 'workflows/{Elder v1,Elder v2}/state.json')
    expect(hits.sort()).toEqual([
      'workflows/Elder%20v1/state.json',
      'workflows/Elder%20v2/state.json',
    ])
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

  it('truncates oversized matched lines so a minified single-line file cannot return whole', () => {
    const giantLine = `{"status":"error"}${'x'.repeat(50_000)}`
    const files = vfsFromEntries([['internal/tool-results/run.json', giantLine]])
    const matches = grep(files, 'status', undefined, { outputMode: 'content' }) as Array<{
      content: string
    }>
    expect(matches).toHaveLength(1)
    expect(matches[0].content.length).toBeLessThan(2_200)
    expect(matches[0].content).toContain('[line truncated: 50018 chars total]')
  })

  it('truncates oversized context lines around a match', () => {
    const files = vfsFromEntries([['a.txt', `before${'y'.repeat(10_000)}\nneedle\nafter`]])
    const matches = grep(files, 'needle', undefined, {
      outputMode: 'content',
      context: 1,
    }) as Array<{
      content: string
    }>
    expect(matches).toHaveLength(3)
    expect(matches[0].content.length).toBeLessThan(2_200)
    expect(matches[1].content).toBe('needle')
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

describe('grepReadResult placeholders', () => {
  const grepResult = (result: {
    content: string
    totalLines: number
    placeholder?: 'oversized' | 'unreadable'
  }) => grepReadResult('files/x.png/content', result, 'x', 'files/x.png/content')

  /**
   * Built from the producers rather than hand-assembled: covers every builder, so
   * one that stops tagging itself fails here.
   */
  const everyPlaceholder = Object.entries({
    fileTooLarge: readPlaceholder.fileTooLarge('big.txt', 99, 5),
    imageTooLarge: readPlaceholder.imageTooLarge('huge.png', 99, 5),
    imageUnavailable: readPlaceholder.imageUnavailable('bomb.png', 90, 'It could not be decoded.'),
    documentTooLarge: readPlaceholder.documentTooLarge('big.pdf', 99, 5),
    compiledArtifactTooLarge: readPlaceholder.compiledArtifactTooLarge('app.js', 99, 5),
    couldNotParse: readPlaceholder.couldNotParse('x.pdf', 'application/pdf', 10),
    binaryFile: readPlaceholder.binaryFile('app.bin', 'application/octet-stream', 10),
  })

  it.each(everyPlaceholder)(
    'reports the %s placeholder instead of grepping it',
    (_name, result) => {
      expect(() => grepResult(result)).toThrow(WorkspaceFileGrepError)
      expect(() => grepResult(result)).toThrow(result.content)
    }
  )

  it('still greps ordinary single-line content', () => {
    expect(grepResult({ content: 'x marks the spot', totalLines: 1 })).toHaveLength(1)
  })

  it('greps a real file whose content is exactly a placeholder message', () => {
    // Untagged, so it is content — text alone never makes something a placeholder.
    const { content } = readPlaceholder.binaryFile('app.bin', 'text/plain', 10)
    expect(grepResult({ content, totalLines: 1 })).toHaveLength(1)
  })
})

describe('decode-normalized matching', () => {
  it('glob matches a decoded display pattern against encoded keys, returning canonical paths', () => {
    const files = new Map([['workflows/Elder%20v2/The%20Elder/state.json', '{}']])
    const matches = glob(files, 'workflows/Elder v2/**')
    expect(matches).toContain('workflows/Elder%20v2/The%20Elder/state.json')
  })

  it('grep scope written in decoded form filters in encoded keys', () => {
    expect(
      pathWithinGrepScope('workflows/Elder%20v2/The%20Elder/state.json', 'workflows/Elder v2')
    ).toBe(true)
    expect(pathWithinGrepScope('workflows/Other/state.json', 'workflows/Elder v2')).toBe(false)
  })
})
