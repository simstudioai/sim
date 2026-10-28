import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from '@/lib/diff/unified'

const runbook = `--- sim:file/wf_runbook
+++ sim:file/wf_runbook
@@ Re-authorizing @@
 ## Re-authorizing
-Tokens never expire, so rotation is not required.
+Tokens rotate every 12h; the refresh job handles it.`

describe('parseUnifiedDiff', () => {
  it('reads the source from sim: header paths and hunks without line numbers', () => {
    const diff = parseUnifiedDiff(runbook)
    expect(diff.oldSource).toEqual({ kind: 'file', fileId: 'wf_runbook' })
    expect(diff.newSource).toEqual(diff.oldSource)
    expect(diff.hunks).toEqual([
      {
        heading: 'Re-authorizing',
        lines: [
          { type: 'context', text: '## Re-authorizing' },
          { type: 'del', text: 'Tokens never expire, so rotation is not required.' },
          { type: 'add', text: 'Tokens rotate every 12h; the refresh job handles it.' },
        ],
      },
    ])
  })

  it('numbers lines from git hunk headers and skips git metadata', () => {
    const diff = parseUnifiedDiff(
      'diff --git a/x.ts b/x.ts\nindex 1..2 100644\n--- a/x.ts\n+++ b/x.ts\n@@ -10,2 +10,2 @@ fn\n keep\n-old\n+new\n\\ No newline at end of file'
    )
    expect(diff.oldSource).toBeNull()
    expect(diff.path).toBe('x.ts')
    expect(diff.hunks[0].heading).toBe('fn')
    expect(diff.hunks[0].lines).toEqual([
      { type: 'context', text: 'keep', oldLine: 10, newLine: 10 },
      { type: 'del', text: 'old', oldLine: 11, newLine: undefined },
      { type: 'add', text: 'new', oldLine: undefined, newLine: 11 },
    ])
  })

  it('reads knowledge document sources', () => {
    expect(parseUnifiedDiff('--- sim:knowledge/kb_1/doc_2\n-a\n+b').newSource).toEqual({
      kind: 'knowledge',
      knowledgeBaseId: 'kb_1',
      documentId: 'doc_2',
    })
  })

  it('splits a multi-file git diff into hunks per file', () => {
    const diff = parseUnifiedDiff(
      'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n-one\n+uno\ndiff --git a/b.ts b/c.ts\nsimilarity index 90%\ncopy from b.ts\ncopy to c.ts\n--- a/b.ts\n+++ b/c.ts\n@@ -3,1 +3,1 @@\n-two\n+dos'
    )
    expect(diff.path).toBe('2 files')
    expect(diff.hunks.map((hunk) => [hunk.file, hunk.lines.map((line) => line.text)])).toEqual([
      ['a.ts', ['one', 'uno']],
      ['c.ts', ['two', 'dos']],
    ])
  })

  it('titles a renamed file by its new path', () => {
    expect(parseUnifiedDiff('--- a/old.ts\n+++ b/new.ts\n@@ -1 +1 @@\n-a\n+b').path).toBe('new.ts')
  })

  it('reads a changed line starting with --- after the headers as a change', () => {
    expect(
      parseUnifiedDiff('--- a/x.md\n+++ b/x.md\n--- divider\n+=== divider').hunks[0].lines
    ).toEqual([
      { type: 'del', text: '-- divider' },
      { type: 'add', text: '=== divider' },
    ])
  })

  it('names each side of a two-document comparison', () => {
    const diff = parseUnifiedDiff(
      '--- sim:knowledge/kb/old\n+++ sim:knowledge/kb/new\n-Refunds are available within 14 days.\n+Annual plans can be refunded within 30 days.'
    )
    expect([diff.oldSource, diff.newSource]).toEqual([
      { kind: 'knowledge', knowledgeBaseId: 'kb', documentId: 'old' },
      { kind: 'knowledge', knowledgeBaseId: 'kb', documentId: 'new' },
    ])
  })

  it.each([
    ['a knowledge source without a document', '--- sim:knowledge/kb_1\n-x\n+y', 'sim:knowledge/'],
    ['a line without a marker', '@@ x @@\n-a\nplain', 'Line 3'],
    ['no changes', ' just context', 'at least one + or - line'],
    [
      'a sim: source mixed with file paths',
      'diff --git a/x b/x\n--- sim:file/f1\n+++ sim:file/f1\n-a\n+b\ndiff --git a/y b/y\n--- a/y.ts\n+++ b/y.ts\n-c\n+d',
      'cannot also include ordinary file paths',
    ],
  ])('rejects %s', (_, text, message) => {
    expect(() => parseUnifiedDiff(text)).toThrow(message)
  })
})
